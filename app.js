/* 画面の操作（ボタン・シート・商品データ） */
(function () {
  'use strict';

  const { Calculator, parse, toPlain, fmt, D } = window.CalcEngine;
  const calc = new Calculator();

  const CATEGORIES = ['1D', '2W', '1M', 'カラー', 'ハードレンズ'];
  const USES = ['近視用', '乱視用', '遠近両用'];
  const STORE_KEY = 'contact-calc-v1';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const yen = (p) => '¥' + fmt(parse(p));

  // ---------- 保存（この端末のブラウザ内） ----------
  let data = { products: [], makers: [] };
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        data.products = Array.isArray(d.products) ? d.products : [];
        data.makers = Array.isArray(d.makers) ? d.makers : [];
      }
    } catch (e) { /* 保存領域が使えない環境でも動かす */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      toast('保存できませんでした（プライベートモードでは保存されません）');
      return false;
    }
  }
  load();

  // ---------- 表示 ----------
  const valueEl = $('value');
  const exprEl = $('expr');

  function render() {
    valueEl.textContent = calc.display;
    valueEl.classList.toggle('error', calc.error);
    exprEl.textContent = calc.expression;
    fitValue();
    document.querySelectorAll('.op').forEach((b) => {
      b.classList.toggle('active', calc.op === b.dataset.op && calc.input === '' && !calc.percent);
    });
    document.querySelectorAll('.pct').forEach((b) => {
      b.classList.toggle('active', !!calc.percent && calc.percent.mode === b.dataset.act);
    });
  }

  // 桁が多いときは文字を小さくして1行に収める
  function fitValue() {
    valueEl.style.fontSize = '';
    const max = valueEl.parentElement.clientWidth - 12;
    let size = parseFloat(getComputedStyle(valueEl).fontSize);
    while (valueEl.scrollWidth > max && size > 18) {
      size -= 2;
      valueEl.style.fontSize = size + 'px';
    }
  }
  window.addEventListener('resize', fitValue);

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function vibrate() {
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
  }

  // ---------- キー操作 ----------
  function press(act, val) {
    switch (act) {
      case 'digit': calc.inputDigit(val); break;
      case 'op': calc.inputOperator(val); break;
      case 'eq': calc.equals(); break;
      case 'ac': calc.reset(); break;
      case 'bs': calc.backspace(); break;
      case 'tax': calc.taxIn(); break;
      case 'off': calc.startPercent('off'); break;
      case 'up': calc.startPercent('up'); break;
    }
    render();
  }

  $('keys').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    vibrate();
    if (b.dataset.d !== undefined) press('digit', b.dataset.d);
    else if (b.dataset.op) press('op', b.dataset.op);
    else press(b.dataset.act);
  });

  // = の長押しで同じ計算を繰り返す
  (function () {
    const eq = document.querySelector('[data-act="eq"]');
    let hold, rep;
    const stop = () => { clearTimeout(hold); clearInterval(rep); };
    eq.addEventListener('pointerdown', () => {
      hold = setTimeout(() => { rep = setInterval(() => press('eq'), 180); }, 500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => eq.addEventListener(ev, stop));
  })();

  // パソコンのキーボードでも使えるように
  document.addEventListener('keydown', (e) => {
    if (!$('overlay').hidden) {
      if (e.key === 'Escape') closeSheet();
      return;
    }
    const k = e.key;
    if (/^[0-9]$/.test(k) || k === '.') press('digit', k);
    else if (['+', '-', '*', '/'].includes(k)) press('op', k);
    else if (k === 'Enter' || k === '=') { e.preventDefault(); press('eq'); }
    else if (k === 'Backspace') press('bs');
    else if (k === 'Escape' || k === 'Delete') press('ac');
    else return;
  });

  // 表示欄タップでコピー
  $('display').addEventListener('click', async () => {
    if (calc.error) return;
    const text = toPlain(calc.currentValue());
    try {
      await navigator.clipboard.writeText(text);
      toast(`${fmt(parse(text))} をコピーしました`);
    } catch (e) {
      toast('コピーできませんでした');
    }
  });

  // ---------- シート（画面遷移の仕組み） ----------
  const overlay = $('overlay');
  let stack = [];

  function showView(view) {
    $('sheetTitle').textContent = view.title;
    $('sheetSub').textContent = view.sub || '';
    $('sheetBack').hidden = stack.length <= 1;
    const body = $('sheetBody');
    body.replaceChildren();
    view.render(body);
    body.scrollTop = 0;
  }
  function openSheet(view) {
    stack = [view];
    overlay.hidden = false;
    showView(view);
  }
  function push(view) { stack.push(view); showView(view); }
  function back() {
    if (stack.length > 1) { stack.pop(); showView(stack[stack.length - 1]); }
  }
  function closeSheet() { overlay.hidden = true; stack = []; }

  $('sheetBack').addEventListener('click', back);
  $('sheetClose').addEventListener('click', closeSheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

  function option(body, label, onClick, right) {
    const b = el('button', 'opt');
    b.type = 'button';
    b.append(el('span', '', label));
    if (right) b.append(el('span', 'price', right));
    b.addEventListener('click', onClick);
    body.append(b);
    return b;
  }

  // ---------- 履歴 ----------
  $('btnHistory').addEventListener('click', () => {
    openSheet({
      title: '計算履歴',
      sub: '新しい順に表示（アプリを閉じると消えます）',
      render(body) {
        if (calc.history.length === 0) {
          body.append(el('div', 'empty', 'まだ計算履歴がありません'));
          return;
        }
        calc.history.forEach((h) => {
          const row = el('div', 'hist');
          const t = el('time', '', h.time.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
          row.append(t, document.createTextNode(h.text));
          body.append(row);
        });
        const clear = el('button', 'btn-sub', '履歴をクリア');
        clear.style.marginTop = '8px';
        clear.addEventListener('click', () => {
          calc.clearHistory();
          showView(stack[stack.length - 1]);
        });
        body.append(clear);
      },
    });
  });

  // ---------- 商品登録 ----------
  $('btnRegister').addEventListener('click', () => openSheet(regCategory()));

  function regCategory() {
    return {
      title: '商品登録',
      sub: '① 種類を選択',
      render(body) {
        CATEGORIES.forEach((c) => option(body, c, () => push(regUse(c))));
        const manage = el('button', 'opt add', `登録済みの商品を見る・削除する（${data.products.length}件）`);
        manage.type = 'button';
        manage.style.marginTop = '10px';
        manage.addEventListener('click', () => push(manageView()));
        body.append(manage);
      },
    };
  }

  function regUse(category) {
    return {
      title: '商品登録',
      sub: `${category} ／ ② 用途を選択`,
      render(body) {
        USES.forEach((u) => option(body, u, () => push(regMaker(category, u))));
      },
    };
  }

  function regMaker(category, use) {
    return {
      title: '商品登録',
      sub: `${category} ・ ${use} ／ ③ メーカーを選択`,
      render(body) {
        data.makers.forEach((m) => option(body, m, () => push(regProduct(category, use, m))));

        const wrap = el('div', 'field');
        wrap.style.marginTop = data.makers.length ? '10px' : '0';
        const label = el('label', '', '＋ 新しいメーカーを追加');
        const input = el('input');
        input.placeholder = '例：メーカーA';
        input.id = 'newMaker';
        label.htmlFor = 'newMaker';
        const add = el('button', 'btn-main', 'このメーカーで次へ');
        add.disabled = true;
        input.addEventListener('input', () => { add.disabled = input.value.trim() === ''; });
        add.addEventListener('click', () => {
          const name = input.value.trim();
          if (!name) return;
          if (!data.makers.includes(name)) { data.makers.push(name); save(); }
          push(regProduct(category, use, name));
        });
        wrap.append(label, input, add);
        body.append(wrap);
        if (!data.makers.length) setTimeout(() => input.focus(), 50);
      },
    };
  }

  function regProduct(category, use, maker) {
    return {
      title: '商品登録',
      sub: `${category} ・ ${use} ・ ${maker} ／ ④ 商品名と金額`,
      render(body) {
        const f1 = el('div', 'field');
        const l1 = el('label', '', '商品名');
        const name = el('input');
        name.id = 'pName';
        name.placeholder = '例：クリアレンズ';
        l1.htmlFor = 'pName';
        f1.append(l1, name);

        const f2 = el('div', 'field');
        const l2 = el('label', '', '金額（円・1箱）');
        const price = el('input');
        price.id = 'pPrice';
        price.inputMode = 'decimal';
        price.placeholder = '例：3000';
        l2.htmlFor = 'pPrice';
        f2.append(l2, price);

        const ok = el('button', 'btn-main', '登録する');
        ok.disabled = true;
        const valid = () => {
          const p = price.value.replace(/[,，\s円¥]/g, '');
          return name.value.trim() !== '' && /^\d+(\.\d+)?$/.test(p) && parse(p) > 0n;
        };
        [name, price].forEach((i) => i.addEventListener('input', () => { ok.disabled = !valid(); }));
        ok.addEventListener('click', () => {
          if (!valid()) return;
          const p = toPlain(parse(price.value.replace(/[,，\s円¥]/g, '')));
          data.products.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            category, use, maker,
            name: name.value.trim(),
            price: p,
          });
          if (save()) toast(`「${name.value.trim()}」${yen(p)} を登録しました`);
          // 同じメーカーで続けて登録できるよう入力欄だけ空にする
          name.value = '';
          price.value = '';
          ok.disabled = true;
          name.focus();
        });

        const note = el('p', 'badge', '登録後もこの画面のまま、同じメーカーの商品を続けて登録できます。');
        body.append(f1, f2, ok, note);
        setTimeout(() => name.focus(), 50);
      },
    };
  }

  function manageView() {
    return {
      title: '登録済みの商品',
      sub: '削除したい商品の「削除」を押してください',
      render(body) {
        if (!data.products.length) {
          body.append(el('div', 'empty', 'まだ商品が登録されていません'));
          return;
        }
        const sorted = [...data.products].sort((a, b) =>
          CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
          USES.indexOf(a.use) - USES.indexOf(b.use) ||
          a.maker.localeCompare(b.maker, 'ja') || a.name.localeCompare(b.name, 'ja'));
        sorted.forEach((p) => {
          const row = el('div', 'opt-row');
          const info = el('div', 'opt');
          const left = el('span');
          left.append(el('div', '', p.name), el('div', 'badge', `${p.category} ・ ${p.use} ・ ${p.maker}`));
          info.append(left, el('span', 'price', yen(p.price)));
          const del = el('button', 'del', '削除');
          del.type = 'button';
          del.addEventListener('click', () => {
            if (!confirm(`「${p.name}」を削除しますか？`)) return;
            data.products = data.products.filter((x) => x.id !== p.id);
            // 商品がなくなったメーカーは一覧から外す
            data.makers = data.makers.filter((m) => data.products.some((x) => x.maker === m));
            save();
            showView(stack[stack.length - 1]);
          });
          row.append(info, del);
          body.append(row);
        });
      },
    };
  }

  // ---------- 商品呼び出し ----------
  $('btnSelect').addEventListener('click', () => {
    if (!data.products.length) {
      openSheet({
        title: '商品呼び出し',
        render(body) {
          body.append(el('div', 'empty', 'まだ商品が登録されていません。\n先に「商品登録」から登録してください。'));
          const go = el('button', 'btn-main', '商品登録へ');
          go.addEventListener('click', () => { stack = []; openSheet(regCategory()); });
          body.append(go);
        },
      });
      return;
    }
    openSheet(selPower());
  });

  function bigChoice(body, items) {
    const g = el('div', 'big-choice');
    items.forEach(([label, small, fn]) => {
      const b = el('button', 'opt');
      b.type = 'button';
      b.append(el('span', '', label), el('small', '', small));
      b.addEventListener('click', fn);
      g.append(b);
    });
    body.append(g);
  }

  function selPower() {
    return {
      title: '商品呼び出し',
      sub: '両目の度数（パワー）は同じですか？',
      render(body) {
        bigChoice(body, [
          ['同じ', '商品を1回選ぶ', () => push(pickCategory({ label: '', done: (p) => finish([p], 1) }))],
          ['違う', '右目・左目を確認', () => push(selSameProduct())],
        ]);
      },
    };
  }

  function selSameProduct() {
    return {
      title: '商品呼び出し',
      sub: '両目とも同じ商品を使いますか？',
      render(body) {
        bigChoice(body, [
          ['同じ商品で揃える', '金額 × 2', () => push(pickCategory({ label: '', done: (p) => finish([p], 2) }))],
          ['違う商品にする', '右目→左目の順に選択', () => push(pickCategory({
            label: '右目',
            done: (right) => push(pickCategory({ label: '左目', done: (left) => finish([right, left], 1) })),
          }))],
        ]);
      },
    };
  }

  // 種類 → 用途 → メーカー → 商品（登録がある選択肢だけ表示）
  function pickCategory(ctx) {
    const pre = ctx.label ? `【${ctx.label}】` : '';
    return {
      title: '商品呼び出し',
      sub: `${pre}種類を選択`,
      render(body) {
        CATEGORIES.filter((c) => data.products.some((p) => p.category === c))
          .forEach((c) => option(body, c, () => push(pickUse(ctx, c))));
      },
    };
  }
  function pickUse(ctx, category) {
    const pre = ctx.label ? `【${ctx.label}】` : '';
    return {
      title: '商品呼び出し',
      sub: `${pre}${category} ／ 用途を選択`,
      render(body) {
        USES.filter((u) => data.products.some((p) => p.category === category && p.use === u))
          .forEach((u) => option(body, u, () => push(pickMaker(ctx, category, u))));
      },
    };
  }
  function pickMaker(ctx, category, use) {
    const pre = ctx.label ? `【${ctx.label}】` : '';
    const makers = [...new Set(data.products
      .filter((p) => p.category === category && p.use === use).map((p) => p.maker))];
    return {
      title: '商品呼び出し',
      sub: `${pre}${category} ・ ${use} ／ メーカーを選択`,
      render(body) {
        makers.forEach((m) => option(body, m, () => push(pickProduct(ctx, category, use, m))));
      },
    };
  }
  function pickProduct(ctx, category, use, maker) {
    const pre = ctx.label ? `【${ctx.label}】` : '';
    return {
      title: '商品呼び出し',
      sub: `${pre}${category} ・ ${use} ・ ${maker} ／ 商品を選択`,
      render(body) {
        data.products
          .filter((p) => p.category === category && p.use === use && p.maker === maker)
          .forEach((p) => option(body, p.name, () => ctx.done(p), yen(p.price)));
      },
    };
  }

  function finish(products, qty) {
    let total = 0n;
    products.forEach((p) => { total = D.add(total, parse(p.price)); });
    total = D.mul(total, parse(String(qty)));
    let label;
    if (products.length === 2) label = `右:${products[0].name} + 左:${products[1].name}`;
    else if (qty === 2) label = `${products[0].name} × 2`;
    else label = products[0].name;
    calc.inputAmount(toPlain(total), label);
    closeSheet();
    render();
    toast(`${label}　${yen(toPlain(total))}`);
  }

  // ---------- 起動 ----------
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
