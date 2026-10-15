/* 電卓エンジン（画面に依存しない計算ロジック）
 * 小数の誤差（0.1 + 0.2 = 0.30000000000000004 など）が出ないよう、
 * BigInt で 10^12 倍した整数として計算する。 */
(function (global) {
  'use strict';

  const SCALE_DIGITS = 12;
  const SCALE = 10n ** BigInt(SCALE_DIGITS);
  const MAX_INPUT_DIGITS = 15;
  const TAX_RATE = '8'; // 税込ボタンの税率（%）

  // ---------- 小数ユーティリティ ----------
  function parse(str) {
    str = String(str).trim();
    let neg = false;
    if (str.startsWith('-')) { neg = true; str = str.slice(1); }
    let [i, f = ''] = str.split('.');
    if (i === '') i = '0';
    f = (f + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
    const v = BigInt(i) * SCALE + BigInt(f);
    return neg ? -v : v;
  }

  function divRound(a, b) {
    // 四捨五入つき整数除算
    const neg = (a < 0n) !== (b < 0n);
    let aa = a < 0n ? -a : a;
    let bb = b < 0n ? -b : b;
    let q = aa / bb;
    if ((aa % bb) * 2n >= bb) q += 1n;
    return neg ? -q : q;
  }

  const D = {
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => divRound(a * b, SCALE),
    div: (a, b) => divRound(a * SCALE, b),
  };

  // 表示用の文字列（カンマなし、小数は最大10桁で末尾の0は消す）
  function toPlain(v) {
    const neg = v < 0n;
    let a = neg ? -v : v;
    // 10桁に丸める
    const cut = 10n ** BigInt(SCALE_DIGITS - 10);
    a = divRound(a, cut) * cut;
    const i = a / SCALE;
    let f = (a % SCALE).toString().padStart(SCALE_DIGITS, '0').slice(0, 10).replace(/0+$/, '');
    const s = i.toString() + (f ? '.' + f : '');
    return (neg && s !== '0' ? '-' : '') + s;
  }

  // 3桁カンマ区切り（入力途中の "12." や "0.50" もそのまま残す）
  function withComma(raw) {
    let neg = raw.startsWith('-');
    if (neg) raw = raw.slice(1);
    const [i, f] = raw.split('.');
    const intPart = (i || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + intPart + (f !== undefined ? '.' + f : '');
  }

  const fmt = (v) => withComma(toPlain(v));
  const OP_LABEL = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  // ---------- 電卓本体 ----------
  class Calculator {
    constructor() {
      this.history = [];
      this.reset();
    }

    reset() {
      this.acc = null;          // 確定した値
      this.op = null;           // 保留中の演算子
      this.input = '';          // 入力中の数字（文字列）
      this.error = false;
      this.justEvaluated = false;
      this.lastOp = null;       // = の繰り返し用
      this.lastOperand = null;
      this.percent = null;      // { mode: 'off'|'up', base }
      this.exprText = '';       // 上段の計算過程表示
    }

    // 今の画面上の値（BigInt）
    currentValue() {
      if (this.input !== '' && this.input !== '-') return parse(this.input);
      if (this.acc !== null) return this.acc;
      return 0n;
    }

    get display() {
      if (this.error) return 'エラー';
      if (this.input !== '') return withComma(this.input);
      if (this.acc !== null) return fmt(this.acc);
      return '0';
    }

    get expression() {
      if (this.error) return '0で割ることはできません';
      return this.exprText;
    }

    _compute(a, op, b) {
      switch (op) {
        case '+': return D.add(a, b);
        case '-': return D.sub(a, b);
        case '*': return D.mul(a, b);
        case '/':
          if (b === 0n) throw new Error('DIV0');
          return D.div(a, b);
      }
      return b;
    }

    _fail() {
      this.reset();
      this.error = true;
    }

    _log(text) {
      this.history.unshift({ text, time: new Date() });
      if (this.history.length > 100) this.history.pop();
    }

    // 保留中の計算を確定させて値を返す（OFF%・税込・商品入力の前に使う）
    _settle() {
      if (this.percent) return this.currentValue();
      if (this.op && this.input !== '') {
        const b = parse(this.input);
        const r = this._compute(this.acc, this.op, b);
        this.acc = r;
      } else if (this.input !== '') {
        this.acc = parse(this.input);
      } else if (this.acc === null) {
        this.acc = 0n;
      }
      this.op = null;
      this.input = '';
      return this.acc;
    }

    inputDigit(d) {
      if (this.error) return;
      if (this.justEvaluated) {
        this.acc = null;
        this.op = null;
        this.exprText = '';
        this.justEvaluated = false;
      }
      if (d === '.') {
        if (this.input.includes('.')) return;
        this.input = (this.input === '' ? '0' : this.input) + '.';
        return;
      }
      const digits = this.input.replace(/[^0-9]/g, '').length;
      if (digits >= MAX_INPUT_DIGITS) return;
      if (this.input === '0') this.input = d;
      else this.input += d;
    }

    inputOperator(op) {
      if (this.error) return;
      try {
        if (this.percent) {
          // OFF%/UP% の率を入れずに演算子を押したら率の入力を取りやめる
          if (this.input === '') {
            this.percent = null;
          } else {
            this.equals();
            if (this.error) return;
          }
        }
        if (this.input !== '') {
          if (this.acc !== null && this.op && !this.justEvaluated) {
            this.acc = this._compute(this.acc, this.op, parse(this.input));
          } else {
            this.acc = parse(this.input);
          }
          this.input = '';
        } else if (this.acc === null) {
          this.acc = 0n;
        }
        this.op = op;
        this.justEvaluated = false;
        this.exprText = fmt(this.acc) + ' ' + OP_LABEL[op];
      } catch (e) {
        this._fail();
      }
    }

    equals() {
      if (this.error) return;
      try {
        // OFF% / UP%
        if (this.percent) {
          if (this.input === '') return;
          const { mode, base } = this.percent;
          const rate = parse(this.input);
          const hundred = parse('100');
          const factor = mode === 'off' ? D.sub(hundred, rate) : D.add(hundred, rate);
          const result = D.div(D.mul(base, factor), hundred);
          const label = `${fmt(base)} の ${toPlain(rate)}%${mode === 'off' ? 'OFF' : 'UP'}`;
          this._log(`${label} = ${fmt(result)}`);
          this.exprText = label + ' =';
          this.acc = result;
          this.input = '';
          this.op = null;
          this.percent = null;
          this.lastOp = null;
          this.justEvaluated = true;
          return;
        }

        let a, op, b;
        if (this.op && this.input !== '') {
          a = this.acc; op = this.op; b = parse(this.input);
        } else if (this.op && this.input === '') {
          // 「5 + =」→ 5 + 5
          a = this.acc; op = this.op; b = this.acc;
        } else if (this.justEvaluated && this.lastOp) {
          // = の繰り返し
          a = this.acc; op = this.lastOp; b = this.lastOperand;
        } else {
          return;
        }
        const r = this._compute(a, op, b);
        const text = `${fmt(a)} ${OP_LABEL[op]} ${fmt(b)}`;
        this._log(`${text} = ${fmt(r)}`);
        this.exprText = text + ' =';
        this.acc = r;
        this.lastOp = op;
        this.lastOperand = b;
        this.op = null;
        this.input = '';
        this.justEvaluated = true;
      } catch (e) {
        this._fail();
      }
    }

    startPercent(mode) {
      if (this.error) return;
      try {
        if (this.percent) {
          // すでにOFF%/UP%モードなら切り替えのみ
          this.percent.mode = mode;
          this.input = '';
        } else {
          const base = this._settle();
          this.percent = { mode, base };
        }
        this.justEvaluated = false;
        this.exprText = `${fmt(this.percent.base)} の □% ${mode === 'off' ? 'OFF' : 'UP'}（率を入力して =）`;
      } catch (e) {
        this._fail();
      }
    }

    taxIn() {
      if (this.error) return;
      try {
        if (this.percent) {
          if (this.input !== '') this.equals();
          else this.percent = null;
          if (this.error) return;
        }
        const base = this._settle();
        const hundred = parse('100');
        const result = D.div(D.mul(base, D.add(hundred, parse(TAX_RATE))), hundred);
        const label = `${fmt(base)} の税込(${TAX_RATE}%)`;
        this._log(`${label} = ${fmt(result)}`);
        this.exprText = label + ' =';
        this.acc = result;
        this.lastOp = null;
        this.justEvaluated = true;
      } catch (e) {
        this._fail();
      }
    }

    backspace() {
      if (this.error) return;
      if (this.input !== '') {
        this.input = this.input.slice(0, -1);
        if (this.input === '-' || this.input === '-0') this.input = '';
        return;
      }
      // 計算結果が出ている状態なら、その結果を編集できるようにする
      if (this.justEvaluated && this.acc !== null) {
        let s = toPlain(this.acc).slice(0, -1);
        if (s === '-' || s.endsWith('.')) s = s.replace(/\.$/, '').replace(/^-$/, '');
        this.input = s === '0' ? '' : s;
        this.acc = null;
        this.op = null;
        this.lastOp = null;
        this.justEvaluated = false;
        this.exprText = '';
      }
    }

    // 商品の金額を電卓に入れる
    inputAmount(amountStr, label) {
      if (this.error) this.reset();
      if (this.justEvaluated || (this.op === null && !this.percent)) {
        this.acc = null;
        this.op = null;
        this.exprText = '';
        this.justEvaluated = false;
      }
      this.input = toPlain(parse(amountStr));
      if (label) this._log(`商品入力: ${label} = ${fmt(parse(amountStr))}`);
    }

    clearHistory() { this.history = []; }
  }

  const api = { Calculator, parse, toPlain, withComma, fmt, D };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CalcEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
