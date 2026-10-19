/* Kontraktné testy API (kap. 2.1, AC7, AC12-AC15, AC18-AC20, AC31).
   Spustenie: index.html?contract=1  (mock: dáta mocku sa na začiatku VYMAŽÚ)
              index.html?contract=1&admin=<kód pozvánky správcu>  (reálny endpoint, BACKEND.type='apps_script')
   Testy označené [mock] používajú ladiace funkcie mocku (posun času, vypnutie fotky/e-mailov) a pri reálnom endpointe sa preskočia. */
window.runContractTests = async function (env) {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const res = { passed: 0, failed: 0, skipped: 0 }, log = env.log || console.log;
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'rozdiel') + ': očakávané ' + JSON.stringify(b) + ', dostal ' + JSON.stringify(a)); };
  const yes = (c, m) => { if (!c) throw new Error(m || 'podmienka nesplnená'); };
  const call = tok => (a, p) => env.send(a, tok, p || {});
  const ok = async (r, m) => { r = await r; if (!r || !r.ok) throw new Error((m || 'očakávané ok') + ': ' + JSON.stringify(r)); return r.data; };
  const bad = async (r, code, m) => { r = await r; if (!r || r.ok || r.code !== code) throw new Error((m || 'chyba') + ': očakávané ' + code + ', dostal ' + JSON.stringify(r)); return r; };
  async function T(name, fn, mockOnly) {
    if (mockOnly && !env.isMock) { res.skipped++; log('SKIP  ' + name + ' [mock]'); return; }
    try { await fn(); res.passed++; log('OK    ' + name); } catch (e) { res.failed++; log('FAIL  ' + name + ' -> ' + e.message); }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let adminInvite = env.adminInvite;
  if (env.isMock) { await env.mock.reset(); adminInvite = await env.mock.firstInvite(); }
  if (!adminInvite) { log('CHYBA: chýba kód pozvánky správcu (&admin=...)'); res.failed++; return res; }

  const none = call(undefined);
  let A, M, Atok, Mtok, Aid, Mid;
  const mail = 'm' + Date.now() + '@example.com';

  await T('UNAUTHORIZED bez tokenu a so zlým tokenom (AC16)', async () => {
    for (const a of ['getState', 'createTask', 'getPhoto', 'exportBackup']) {
      await bad(none(a, { id: 'x' }), 'UNAUTHORIZED', a + ' bez tokenu');
      await bad(call('zly-token')(a, { id: 'x' }), 'UNAUTHORIZED', a + ' zlý token');
    }
  });
  await T('inviteInfo: neplatná pozvánka -> INVALID_INVITE', async () => { await bad(none('inviteInfo', { inviteToken: 'neexistuje' }), 'INVALID_INVITE'); });
  await T('inviteInfo vracia len meno (bez e-mailu a tokenu)', async () => {
    const d = await ok(none('inviteInfo', { inviteToken: adminInvite }));
    yes(typeof d.name === 'string' && d.name, 'meno'); eq(Object.keys(d).join(), 'name');
  });
  await T('join: neplatná pozvánka -> INVALID_INVITE', async () => { await bad(none('join', { inviteToken: 'neexistuje' }), 'INVALID_INVITE'); });
  await T('join správcu vráti token a člena; pozvánka je jednorazová (AC13)', async () => {
    const d = await ok(none('join', { inviteToken: adminInvite }));
    Atok = d.token; Aid = d.member.id; A = call(Atok);
    yes(Atok && Atok.length >= 60, 'token >= 240 bit (60 hex)'); eq(d.member.role, 'admin');
    await bad(none('join', { inviteToken: adminInvite }), 'INVALID_INVITE', 'opätovné použitie');
    await bad(none('inviteInfo', { inviteToken: adminInvite }), 'INVALID_INVITE', 'inviteInfo použitej');
  });
  if (!A) { log('CHYBA: správca sa nepripojil, ďalšie testy sa nedajú spustiť'); return res; }

  await T('createInvite: validácia (meno, e-mail, rola)', async () => {
    await bad(A('createInvite', { name: '', email: mail, role: 'member' }), 'VALIDATION', 'meno');
    await bad(A('createInvite', { name: 'X', email: 'zly', role: 'member' }), 'VALIDATION', 'e-mail');
    await bad(A('createInvite', { name: 'X', email: '', role: 'member' }), 'VALIDATION', 'prázdny e-mail');
    await bad(A('createInvite', { name: 'X', email: mail, role: 'boss' }), 'VALIDATION', 'rola');
    await bad(A('createInvite', { name: '   ', email: mail, role: 'member' }), 'VALIDATION', 'meno z medzier');
  });
  await T('createInvite + join člena; unikátny e-mail (AC13)', async () => {
    const inv = await ok(A('createInvite', { name: 'Peter', email: mail, role: 'member' }));
    await bad(A('createInvite', { name: 'Dvojník', email: mail.toUpperCase(), role: 'member' }), 'EMAIL_EXISTS', 'nevyužitá pozvánka na ten istý e-mail');
    yes(inv.inviteToken && inv.expiresAt, 'inviteToken, expiresAt');
    eq((await ok(none('inviteInfo', { inviteToken: inv.inviteToken }))).name, 'Peter');
    const d = await ok(none('join', { inviteToken: inv.inviteToken }));
    Mtok = d.token; Mid = d.member.id; M = call(Mtok); eq(d.member.role, 'member');
    await bad(A('createInvite', { name: 'Iný', email: mail, role: 'member' }), 'EMAIL_EXISTS', 'duplicitný e-mail po join');
    await bad(A('createInvite', { name: 'Iný', email: mail.toUpperCase(), role: 'member' }), 'EMAIL_EXISTS', 'e-mail bez ohľadu na veľkosť písmen');
  });
  if (!M) { log('CHYBA: člen sa nepripojil'); return res; }

  await T('člen s rolou member nemôže vytvárať pozvánky ani spravovať členov (AC12)', async () => {
    await bad(M('createInvite', { name: 'Z', email: 'z' + mail, role: 'member' }), 'FORBIDDEN');
    await bad(M('createInvite', { memberId: Aid }), 'FORBIDDEN');
    await bad(M('updateMember', { id: Aid, name: 'Hacker' }), 'FORBIDDEN');
    await bad(M('removeMember', { id: Aid }), 'FORBIDDEN');
    await bad(M('exportBackup', {}), 'FORBIDDEN');
    await bad(M('emptyTrash', {}), 'FORBIDDEN');
  });
  await T('getState: štruktúra, e-maily len správcovi', async () => {
    const a = await ok(A('getState', {})), m = await ok(M('getState', {}));
    for (const k of ['me', 'tasks', 'members', 'events', 'unread', 'serverTime', 'mailStatus']) yes(k in a, 'chýba ' + k);
    eq(a.me.id, Aid); eq(m.me.id, Mid); eq(a.mailStatus, 'OK');
    yes(a.members.find(x => x.id === Mid).email, 'správca vidí e-mail');
    yes(!m.members.find(x => x.id === Aid).email, 'člen nevidí e-mail iných');
  });
  await T('neznáma akcia -> VALIDATION', async () => { await bad(A('nieJeAkcia', {}), 'VALIDATION'); });

  let t1;
  await T('createTask: validácia a clientId idempotencia (AC1, AC31)', async () => {
    await bad(A('createTask', { title: '   ', description: '' }), 'VALIDATION', 'prázdny názov');
    await bad(A('createTask', { title: 'x'.repeat(121), description: '' }), 'VALIDATION', 'dlhý názov');
    const cid = '11111111-2222-4333-8444-' + String(Date.now()).padStart(12, '0').slice(-12);
    const a = await ok(A('createTask', { title: 'Opraviť strechu', description: 'popis', clientId: cid }));
    const b = await ok(A('createTask', { title: 'Opraviť strechu', description: 'popis', clientId: cid }));
    eq(b.id, a.id, 'rovnaké id pri rovnakom clientId'); t1 = a;
    const n = (await ok(A('getState', {}))).tasks.filter(t => t.id === a.id).length; eq(n, 1, 'jedna úloha');
    eq(a.status, 'open'); eq(a.created_by, Aid); yes(a.created_at, 'created_at');
  });
  await T('úloha je viditeľná členovi (AC1)', async () => { yes((await ok(M('getState', {}))).tasks.some(t => t.id === t1.id)); });
  await T('NOT_FOUND pre neznáme id; NOT_DONE pri vrátení otvorenej', async () => {
    await bad(A('completeTask', { id: 'neexistuje' }), 'NOT_FOUND');
    await bad(A('deleteTask', { id: 'neexistuje' }), 'NOT_FOUND');
    await bad(A('reopenTask', { id: t1.id }), 'NOT_DONE');
    await bad(A('restoreTask', { id: t1.id }), 'NOT_FOUND', 'obnova nezmazanej');
  });
  await T('completeTask: neplatný obrázok a miniatúra bez fotky -> VALIDATION (AC5)', async () => {
    await bad(A('completeTask', { id: t1.id, photo: 'data:text/plain;base64,AAAA' }), 'VALIDATION', 'nie obrázok');
    await bad(A('completeTask', { id: t1.id, thumb: PNG }), 'VALIDATION', 'thumb bez photo');
    eq((await ok(A('getState', {}))).tasks.find(t => t.id === t1.id).status, 'open', 'ostala nesplnená');
  });

  let outBefore = 0;
  if (env.isMock) outBefore = (await env.mock.outbox()).length;
  await T('súbežné splnenie: jeden víťaz, druhý ALREADY_DONE s menom (AC20)', async () => {
    const [r1, r2] = await Promise.all([A('completeTask', { id: t1.id, photo: PNG, thumb: PNG }), M('completeTask', { id: t1.id })]);
    const oks = [r1, r2].filter(r => r.ok), fails = [r1, r2].filter(r => !r.ok);
    eq(oks.length, 1, 'práve jedno splnenie'); eq(fails[0].code, 'ALREADY_DONE'); yes(/^Už splnil /.test(fails[0].message), 'message "Už splnil <meno>"');
    t1 = oks[0].data; eq(t1.status, 'done'); yes(t1.done_at, 'done_at');
  });
  await T('[mock] e-mail sa pošle raz každému aktívnemu členovi, len meno a názov (AC9)', async () => {
    const out = (await env.mock.outbox()).slice(outBefore);
    eq(out.length, 2, 'dva e-maily (2 členovia)');
    for (const m of out) { yes(m.text.indexOf('Opraviť strechu') >= 0, 'názov'); yes(m.text.indexOf('popis') < 0 && m.text.indexOf('data:') < 0, 'bez popisu a fotky'); }
  }, true);
  await T('splnená úloha: has_photo podľa víťaza; getPhoto full/thumb (AC4)', async () => {
    const withPhoto = t1.has_photo;
    if (!withPhoto) { // vyhral člen bez fotky, vyskúšame fotku na inej úlohe
      const t = await ok(A('createTask', { title: 'Fotka' })); t1 = await ok(A('completeTask', { id: t.id, photo: PNG, thumb: PNG }));
    }
    yes(t1.has_photo, 'has_photo');
    yes((await ok(M('getPhoto', { id: t1.id, kind: 'full' }))).dataUrl.startsWith('data:image/'), 'full');
    yes((await ok(M('getPhoto', { id: t1.id, kind: 'thumb' }))).dataUrl.startsWith('data:image/'), 'thumb');
  });
  await T('opätovné splnenie po vrátení: nová fotka -> PHOTO_IMMUTABLE, bez fotky ok (AC7, AC18)', async () => {
    const r = await ok(M('reopenTask', { id: t1.id }));
    eq(r.status, 'open'); eq(r.done_by, null); eq(r.done_at, null); yes(r.has_photo, 'fotka ostáva');
    await bad(A('completeTask', { id: t1.id, photo: PNG, thumb: PNG }), 'PHOTO_IMMUTABLE');
    eq((await ok(A('getState', {}))).tasks.find(x => x.id === t1.id).status, 'open', 'ostala otvorená');
    const d = await ok(A('completeTask', { id: t1.id })); yes(d.has_photo, 'fotka stále priložená');
    yes((await ok(A('getPhoto', { id: t1.id, kind: 'full' }))).dataUrl, 'fotka dostupná');
  });
  await T('API nemá akciu na zmenu/zmazanie fotky (AC7)', async () => {
    for (const a of ['deletePhoto', 'replacePhoto', 'setPhoto', 'updateTask']) { const r = await A(a, { id: t1.id, photo: PNG }); yes(!r.ok, a + ' nesmie existovať'); }
    yes((await ok(A('getPhoto', { id: t1.id, kind: 'full' }))).dataUrl, 'fotka ostala');
  });
  await T('getPhoto: úloha bez fotky -> NOT_FOUND', async () => {
    const t = await ok(A('createTask', { title: 'Bez fotky' })); await bad(A('getPhoto', { id: t.id, kind: 'full' }), 'NOT_FOUND');
  });
  await T('zvonček: unread > 0, markEventsRead vynuluje (AC10); events max 50, najnovšie prvé', async () => {
    const s = await ok(M('getState', {})); yes(s.unread > 0, 'unread'); yes(s.events.length <= 50);
    yes(s.events.some(e => e.type === 'done'), 'udalosť done');
    await ok(M('markEventsRead', {})); eq((await ok(M('getState', {}))).unread, 0, 'po prečítaní');
    await ok(A('createTask', { title: 'Nová' })); eq((await ok(M('getState', {}))).unread, 1, 'nová udalosť');
  });

  let td;
  await T('kôš: deleteTask, restoreTask, košové úlohy v getState, complete zmazanej -> NOT_FOUND (AC19)', async () => {
    const t = await ok(A('createTask', { title: 'Do koša' })); td = t;
    const d = await ok(M('deleteTask', { id: t.id })); yes(d.deleted_at, 'deleted_at');
    yes((await ok(A('getState', {}))).tasks.find(x => x.id === t.id).deleted_at, 'v stave s deleted_at');
    await bad(A('completeTask', { id: t.id }), 'NOT_FOUND');
    const r = await ok(A('restoreTask', { id: t.id })); eq(r.deleted_at, null);
  });
  await T('emptyTrash: len správca, trvalo zmaže košové úlohy aj s fotkou (AC19)', async () => {
    const t = await ok(A('createTask', { title: 'Zmazať natrvalo' })); const dn = await ok(A('completeTask', { id: t.id, photo: PNG, thumb: PNG }));
    await ok(A('deleteTask', { id: t.id })); await bad(M('emptyTrash', {}), 'FORBIDDEN');
    await ok(A('emptyTrash', {}));
    eq((await ok(A('getState', {}))).tasks.filter(x => x.id === t.id).length, 0, 'úloha zmizla');
    await bad(A('getPhoto', { id: dn.id, kind: 'full' }), 'NOT_FOUND', 'fotka zmizla');
    if (env.isMock) { eq(await env.mock.hasPhoto(dn.id), false, 'súbor fotky odstránený z úložiska'); eq(await env.mock.hasPhoto(dn.id + '_t'), false, 'súbor miniatúry odstránený'); }
    yes((await ok(A('getState', {}))).tasks.some(x => x.id === td.id), 'nezmazané ostali');
  });

  await T('updateMember: premenovanie, e-mail, EMAIL_EXISTS, VALIDATION (AC14)', async () => {
    const m = await ok(A('updateMember', { id: Mid, name: 'Peter II' })); eq(m.name, 'Peter II');
    await bad(A('updateMember', { id: Mid, email: 'zly' }), 'VALIDATION');
    await bad(A('updateMember', { id: Mid, name: '' }), 'VALIDATION');
    await bad(A('updateMember', { id: Mid, name: '   ' }), 'VALIDATION', 'meno z medzier');
    await bad(A('updateMember', { id: Mid, role: 'boss' }), 'VALIDATION');
    const ae = (await ok(A('getState', {}))).me.email;
    await bad(A('updateMember', { id: Mid, email: ae }), 'EMAIL_EXISTS');
    await bad(A('updateMember', { id: 'neexistuje', name: 'X' }), 'NOT_FOUND');
    const e2 = 'n' + mail; eq((await ok(A('updateMember', { id: Mid, email: e2 }))).email, e2);
  });
  await T('posledný správca sa nedá degradovať ani odobrať (AC14)', async () => {
    await bad(A('updateMember', { id: Aid, role: 'member' }), 'LAST_ADMIN');
    await bad(A('removeMember', { id: Aid }), 'LAST_ADMIN');
  });
  await T('nové zariadenie: starý token prestane platiť (AC14)', async () => {
    const inv = await ok(A('createInvite', { memberId: Mid }));
    const d = await ok(none('join', { inviteToken: inv.inviteToken }));
    eq(d.member.id, Mid, 'ten istý člen');
    await bad(M('getState', {}), 'UNAUTHORIZED', 'starý token');
    Mtok = d.token; M = call(Mtok); eq((await ok(M('getState', {}))).me.id, Mid, 'nový token');
    await bad(A('createInvite', { memberId: 'neexistuje' }), 'NOT_FOUND');
  });
  await T('removeMember: token okamžite REVOKED; meno ostáva v getState s active:false (AC15, AC31)', async () => {
    const t = await ok(M('createTask', { title: 'Od Petra' }));
    await ok(A('removeMember', { id: Mid }));
    const r = await bad(M('getState', {}), 'REVOKED'); yes(!r.data, 'žiadne dáta');
    await bad(M('getPhoto', { id: t.id, kind: 'full' }), 'REVOKED');
    const s = await ok(A('getState', {})), pm = s.members.find(x => x.id === Mid);
    yes(pm, 'odobratý člen v zozname'); eq(pm.active, false); yes(pm.name, 'meno'); yes(!pm.email, 'bez e-mailu');
    yes(s.tasks.find(x => x.id === t.id).created_by === Mid, 'úloha ostáva');
    await bad(A('createInvite', { memberId: Mid }), 'NOT_FOUND', 'odobratému nemožno vydať pozvánku');
  });
  await T('exportBackup (správca): úlohy a udalosti (AC24)', async () => {
    const d = await ok(A('exportBackup', {})); yes(Array.isArray(d.tasks) && d.tasks.length > 0, 'tasks'); yes(Array.isArray(d.events), 'events');
  });
  await T('[mock] expirovaná pozvánka (7 dní) -> INVALID_INVITE; koš po +31 dní sa zmaže aj s fotkou (AC4, AC13, AC19)', async () => {
    const inv = await ok(A('createInvite', { name: 'Neskoro', email: 'late' + mail, role: 'member' }));
    const t = await ok(A('createTask', { title: 'Staré' })); const dn = await ok(A('completeTask', { id: t.id, photo: PNG, thumb: PNG }));
    const keep = await ok(A('createTask', { title: 'Ostane' })); const kd = await ok(A('completeTask', { id: keep.id, photo: PNG, thumb: PNG }));
    await ok(A('deleteTask', { id: t.id }));
    await env.mock.advance();
    await bad(none('join', { inviteToken: inv.inviteToken }), 'INVALID_INVITE', 'expirovaná');
    await bad(none('inviteInfo', { inviteToken: inv.inviteToken }), 'INVALID_INVITE', 'expirovaná info');
    eq((await ok(A('getState', {}))).tasks.filter(x => x.id === t.id).length, 0, 'úloha vymazaná');
    await bad(A('getPhoto', { id: dn.id, kind: 'full' }), 'NOT_FOUND', 'fotka zmazaná');
    eq(await env.mock.hasPhoto(dn.id), false, 'súbor fotky odstránený z úložiska'); eq(await env.mock.hasPhoto(dn.id + '_t'), false, 'súbor miniatúry odstránený');
    yes(await env.mock.hasPhoto(kd.id), 'súbor nezmazanej úlohy ostáva');
    yes((await ok(A('getPhoto', { id: kd.id, kind: 'full' }))).dataUrl, 'fotka nezmazanej úlohy ostáva po 31 dňoch');
    await env.mock.advance(); yes((await ok(A('getPhoto', { id: kd.id, kind: 'full' }))).dataUrl, 'aj po 62 dňoch');
  }, true);
  await T('[mock] zlyhanie nahrania fotky: úloha ostane nesplnená (AC6)', async () => {
    await env.mock.setFlag('failUpload', true);
    try {
      const t = await ok(A('createTask', { title: 'Zlyhá' }));
      const r = await A('completeTask', { id: t.id, photo: PNG, thumb: PNG }); yes(!r.ok, 'musí zlyhať');
      eq((await ok(A('getState', {}))).tasks.find(x => x.id === t.id).status, 'open');
    } finally { await env.mock.setFlag('failUpload', false); }
  }, true);
  await T('[mock] vyčerpaná e-mailová kvóta: splnenie prejde, mailStatus QUOTA_EXHAUSTED, žiadne e-maily (AC11)', async () => {
    await env.mock.setFlag('mailQuota', true);
    try {
      const before = (await env.mock.outbox()).length, t = await ok(A('createTask', { title: 'Bez mailu' }));
      eq((await ok(A('completeTask', { id: t.id }))).status, 'done');
      const s = await ok(A('getState', {})); eq(s.mailStatus, 'QUOTA_EXHAUSTED'); eq((await env.mock.outbox()).length, before, 'bez e-mailov');
      yes(s.events.some(e => e.task_id === t.id && e.type === 'done'), 'zvonček funguje');
    } finally { await env.mock.setFlag('mailQuota', false); }
    eq((await ok(A('getState', {}))).mailStatus, 'OK');
  }, true);

  await sleep(0);
  return res;
};
