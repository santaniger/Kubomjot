/* Кубомёт: калькулятор кидків D&D 5e */

(function () {
'use strict';

/* Правила. Чисті обчислення, DOM не чіпають */

var ALLOWED_FACES = [2, 3, 4, 6, 8, 10, 12, 20, 100];
var MAX_TERMS = 10;
var HISTORY_LIMIT = 20;
var MINUS = '−';                 /* типографічний мінус для виводу */

function FormulaError(message) { this.message = message; }

/* модифікатор характеристики */
function abilityModifier(score) { return Math.trunc((score - 10) / 2); }

/* бонус майстерності */
function proficiencyBonus(level) { return 2 + Math.floor((level - 1) / 4); }

function signed(n) { return n < 0 ? MINUS + Math.abs(n) : '+' + n; }
function num(n) { return n < 0 ? MINUS + Math.abs(n) : String(n); }

function rollDie(faces) { return Math.floor(Math.random() * faces) + 1; }

/* Кидок d20 з урахуванням переваги та завади.
   Крит і автопромах визначаються за вибраним кубиком. */
function rollD20(mode) {
  var dice = [rollDie(20)];
  if (mode === 'adv' || mode === 'dis') dice.push(rollDie(20));
  var value = dice[0];
  if (dice.length === 2) {
    value = Math.max(dice[0], dice[1]);
  }
  return { dice: dice, value: value, isCrit: value === 20, isFumble: value === 1 };
}

function d20Text(r) {
  if (r.dice.length === 1) return 'd20: ' + r.dice[0];
  var marked = false;
  var parts = r.dice.map(function (d) {
    if (!marked && d === r.value) { marked = true; return '[' + d + ']'; }
    return String(d);
  });
  return 'd20: ' + parts.join(', ');
}

/* розбір формули виду 3d4+d8-1 */
function parseFormula(input) {
  var s = String(input === null || input === undefined ? '' : input).replace(/\s+/g, '').toLowerCase();
  if (!s) throw new FormulaError('Укажите формулу. Пример: 3d4+d8-1');

  var terms = [];
  var i = 0;
  while (i < s.length) {
    var sign = 1;
    var ch = s.charAt(i);
    if (ch === '+' || ch === '-') {
      sign = (ch === '-') ? -1 : 1;
      i++;
    } else if (terms.length > 0) {
      throw new FormulaError('Пропущен знак между слагаемыми. Пример: 3d4+d8-1');
    }
    var j = i;
    while (j < s.length && s.charAt(j) !== '+' && s.charAt(j) !== '-') j++;
    var body = s.slice(i, j);
    if (!body) throw new FormulaError('Пустое слагаемое, проверьте знаки. Пример: 3d4+d8-1');
    terms.push(parseTerm(body, sign));
    if (terms.length > MAX_TERMS) throw new FormulaError('Слишком много слагаемых, максимум ' + MAX_TERMS);
    i = j;
  }
  return terms;
}

function parseTerm(body, sign) {
  if (/^\d+$/.test(body)) {
    var v = Number(body);
    if (v > 999) throw new FormulaError('Константа должна быть от 0 до 999');
    return { sign: sign, constant: v };
  }
  var m = /^(\d*)d(\d+)$/.exec(body);
  if (!m) throw new FormulaError('Не удалось разобрать "' + body + '". Пример: 3d4+d8-1');
  var count = (m[1] === '') ? 1 : Number(m[1]);
  var faces = Number(m[2]);
  if (count < 1 || count > 100) throw new FormulaError('Количество кубиков должно быть от 1 до 100');
  if (ALLOWED_FACES.indexOf(faces) === -1) {
    throw new FormulaError('Кубик d' + faces + ' не поддерживается. Доступны: ' +
      ALLOWED_FACES.map(function (f) { return 'd' + f; }).join(', '));
  }
  return { sign: sign, count: count, faces: faces };
}

/* при криті подвоюється кількість кубиків, модифікатор не чіпаємо */
function rollFormula(terms, doubleDice) {
  var total = 0;
  var parts = [];
  terms.forEach(function (t, idx) {
    var value, piece;
    if (t.constant !== undefined) {
      value = t.constant;
      piece = String(t.constant);
    } else {
      var count = doubleDice ? t.count * 2 : t.count;
      var rolls = [];
      for (var k = 0; k < count; k++) rolls.push(rollDie(t.faces));
      value = rolls.reduce(function (a, b) { return a + b; }, 0);
      piece = count + 'd' + t.faces + ' [' + rolls.join(', ') + ']';
    }
    total += t.sign * value;
    if (idx === 0) parts.push((t.sign < 0 ? MINUS + ' ' : '') + piece);
    else parts.push((t.sign < 0 ? MINUS : '+') + ' ' + piece);
  });
  return { total: total, text: parts.join(' ') };
}

/* Стан і сховище */

var STORAGE_KEY = 'kubomet.character.v1';
var STATE_VERSION = 1;
var DAMAGE_OWN = '__own__';

var state;
var storageAvailable = true;
var weaponSeq = 1;
var errors = {};

var roll = {
  type: 'skill',
  skill: SKILLS[0].name,
  save: 'dex',
  weaponId: null,
  mode: 'normal',
  crit: false
};

function defaultState() {
  var s = {
    version: STATE_VERSION,
    name: '', level: 1,
    abilities: {}, saves: {}, skills: {},
    spellAbility: 'int',
    ac: 10, hp: 8, speed: 30,
    weapons: [], history: [], theme: 'dark'
  };
  ABILITIES.forEach(function (a) { s.abilities[a.key] = 10; s.saves[a.key] = false; });
  SKILLS.forEach(function (sk) { s.skills[sk.name] = false; });
  return s;
}

function clampInt(value, min, max, fallback) {
  var n = parseInt(value, 10);
  if (isNaN(n) || n < min || n > max) return fallback;
  return n;
}

/* Пошкоджені або часткові дані не повинні ламати застосунок */
function sanitize(raw) {
  var s = defaultState();
  if (!raw || typeof raw !== 'object') return s;

  if (typeof raw.name === 'string') s.name = raw.name.slice(0, 40);
  s.level = clampInt(raw.level, 1, 20, 1);
  s.ac    = clampInt(raw.ac, 1, 30, 10);
  s.hp    = clampInt(raw.hp, 1, 999, 8);
  s.speed = clampInt(raw.speed, 0, 200, 30);

  if (raw.abilities) ABILITIES.forEach(function (a) {
    s.abilities[a.key] = clampInt(raw.abilities[a.key], 1, 30, 10);
  });
  if (raw.saves) ABILITIES.forEach(function (a) { s.saves[a.key] = raw.saves[a.key] === true; });
  if (raw.skills) SKILLS.forEach(function (sk) { s.skills[sk.name] = raw.skills[sk.name] === true; });

  if (SPELL_ABILITIES.indexOf(raw.spellAbility) !== -1 || raw.spellAbility === 'none') {
    s.spellAbility = raw.spellAbility;
  }
  if (Object.prototype.toString.call(raw.weapons) === '[object Array]') {
    s.weapons = raw.weapons.slice(0, 10).map(function (w) {
      w = w || {};
      return {
        id: weaponSeq++,
        name: typeof w.name === 'string' ? w.name.slice(0, 30) : '',
        ability: (w.ability === 'dex') ? 'dex' : 'str',
        prof: w.prof === true,
        dice: typeof w.dice === 'string' ? w.dice.slice(0, 20) : '1d6',
        type: typeof w.type === 'string' ? w.type.slice(0, 20) : ''
      };
    });
  }
  if (Object.prototype.toString.call(raw.history) === '[object Array]') {
    s.history = raw.history.slice(0, HISTORY_LIMIT).filter(function (h) {
      return h && typeof h === 'object' && typeof h.title === 'string';
    });
  }
  s.theme = (raw.theme === 'light') ? 'light' : 'dark';
  return s;
}

function warn(text) {
  var el = document.getElementById('storage-warning');
  el.textContent = text;
  el.hidden = false;
}

function load() {
  var raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    storageAvailable = false;
    warn('Сохранение недоступно, данные будут потеряны при закрытии.');
    return defaultState();
  }
  if (!raw) return defaultState();
  try {
    var data = JSON.parse(raw);
    if (!data || data.version !== STATE_VERSION) throw new Error('несовпадение версии');
    return sanitize(data);
  } catch (e) {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e2) { /* нічого чистити */ }
    warn('Сохранённые данные повреждены, лист сброшен.');
    return defaultState();
  }
}

function save() {
  if (!storageAvailable) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    storageAvailable = false;
    warn('Сохранение недоступно, данные будут потеряны при закрытии.');
  }
}

/* Похідні величини */

function prof() { return proficiencyBonus(state.level); }
function mod(key) { return abilityModifier(state.abilities[key]); }

function abilityByKey(key) {
  for (var i = 0; i < ABILITIES.length; i++) if (ABILITIES[i].key === key) return ABILITIES[i];
  return ABILITIES[0];
}
function skillByName(name) {
  for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].name === name) return SKILLS[i];
  return SKILLS[0];
}
function typeInfo() {
  for (var i = 0; i < ROLL_TYPES.length; i++) if (ROLL_TYPES[i].id === roll.type) return ROLL_TYPES[i];
  return ROLL_TYPES[0];
}
function currentWeapon() {
  if (roll.weaponId === null || roll.weaponId === DAMAGE_OWN) return null;
  var id = String(roll.weaponId);
  for (var i = 0; i < state.weapons.length; i++) {
    if (String(state.weapons[i].id) === id) return state.weapons[i];
  }
  return null;
}

function skillBonus(sk)   { return mod(sk.ability) + (state.skills[sk.name] ? prof() : 0); }
function saveBonus(key)   { return mod(key) + (state.saves[key] ? prof() : 0); }
function weaponBonus(w)   { return mod(w.ability) + (w.prof ? prof() : 0); }
function spellAttackBonus() { return state.spellAbility === 'none' ? 0 : prof() + mod(state.spellAbility); }
function spellDC()          { return state.spellAbility === 'none' ? null : 8 + prof() + mod(state.spellAbility); }

/* Валідація */

var NUM_FIELDS = [
  { id: 'f-level', key: 'level', min: 0, max: 20,  msg: 'Уровень должен быть от 1 до 20' },
  { id: 'f-ac',    key: 'ac',    min: 1, max: 30,  msg: 'Класс защиты должен быть от 1 до 30' },
  { id: 'f-hp',    key: 'hp',    min: 1, max: 999, msg: 'Максимум хитов должен быть от 1 до 999' },
  { id: 'f-speed', key: 'speed', min: 0, max: 200, msg: 'Скорость должна быть от 0 до 200' }
];
var SHEET_ERRORS = ['level', 'ac', 'hp', 'speed', 'abilities'];

function setError(name, message) {
  errors[name] = message || null;
  var box = document.querySelector('[data-err="' + name + '"]');
  if (box) box.textContent = message || '';
}

function digitsOnly(el) {
  var cleaned = el.value.replace(/[^\d]/g, '');
  if (cleaned !== el.value) el.value = cleaned;
  return cleaned;
}

function blocked() {
  for (var i = 0; i < SHEET_ERRORS.length; i++) if (errors[SHEET_ERRORS[i]]) return true;
  if (errors.target) return true;

  var t = typeInfo();
  var ownFormula = (roll.type === 'damage' && roll.weaponId === DAMAGE_OWN);
  if ((t.id === 'formula' || ownFormula) && errors.formula) return true;
  if (errors.weapon) return true;

  var w = currentWeapon();
  if (w && (t.id === 'weapon' || t.id === 'damage') && errors['wdice-' + w.id]) return true;
  return false;
}

function updateRollButton() {
  document.getElementById('roll').disabled = blocked();
}

/* Побудова інтерфейсу */

function buildAbilities() {
  var box = document.getElementById('abilities');
  ABILITIES.forEach(function (a) {
    var row = document.createElement('div');
    row.className = 'ability';
    row.innerHTML =
      '<span class="ability-name">' + a.name + '</span>' +
      '<input class="num" type="text" inputmode="numeric" maxlength="2" id="ab-' + a.key + '">' +
      '<span class="ability-mod" id="mod-' + a.key + '">+0</span>';
    box.appendChild(row);
  });

  var err = document.createElement('p');
  err.className = 'err';
  err.setAttribute('data-err', 'abilities');
  box.parentNode.insertBefore(err, box.nextSibling);

  ABILITIES.forEach(function (a) {
    document.getElementById('ab-' + a.key).addEventListener('input', function () {
      var raw = digitsOnly(this);
      var n = parseInt(raw, 10);
      if (raw === '' || isNaN(n) || n < 1 || n > 30) {
        this.classList.add('invalid');
        setError('abilities', 'Параметр должен быть от 1 до 30');
      } else {
        this.classList.remove('invalid');
        state.abilities[a.key] = n;
        if (!anyAbilityInvalid()) setError('abilities', null);
        save();
      }
      updateComputed();
      updateRollButton();
    });
  });
}

function anyAbilityInvalid() {
  for (var i = 0; i < ABILITIES.length; i++) {
    if (document.getElementById('ab-' + ABILITIES[i].key).classList.contains('invalid')) return true;
  }
  return false;
}

function buildChecklists() {
  var skillBox = document.getElementById('skills');
  SKILLS.forEach(function (sk) {
    var row = document.createElement('label');
    row.className = 'check-row';
    row.innerHTML =
      '<input type="checkbox">' +
      '<span class="cr-name"></span>' +
      '<span class="cr-ability"></span>' +
      '<span class="cr-bonus">+0</span>';
    row.querySelector('.cr-name').textContent = sk.name;
    row.querySelector('.cr-ability').textContent = abilityByKey(sk.ability).short;
    row.querySelector('.cr-bonus').id = 'sk-bonus-' + SKILLS.indexOf(sk);
    var cb = row.querySelector('input');
    cb.id = 'sk-' + SKILLS.indexOf(sk);
    cb.addEventListener('change', function () {
      state.skills[sk.name] = this.checked;
      updateComputed(); save();
    });
    skillBox.appendChild(row);
  });

  var saveBox = document.getElementById('saves');
  ABILITIES.forEach(function (a) {
    var row = document.createElement('label');
    row.className = 'check-row';
    row.innerHTML =
      '<input type="checkbox" id="sv-' + a.key + '">' +
      '<span class="cr-name"></span>' +
      '<span class="cr-bonus" id="sv-bonus-' + a.key + '">+0</span>';
    row.querySelector('.cr-name').textContent = a.name;
    row.querySelector('input').addEventListener('change', function () {
      state.saves[a.key] = this.checked;
      updateComputed(); save();
    });
    saveBox.appendChild(row);
  });
}

function buildSelects() {
  var spell = document.getElementById('f-spell');
  SPELL_ABILITIES.forEach(function (key) {
    var o = document.createElement('option');
    o.value = key; o.textContent = abilityByKey(key).name;
    spell.appendChild(o);
  });
  var none = document.createElement('option');
  none.value = 'none'; none.textContent = 'нет';
  spell.appendChild(none);

  var skill = document.getElementById('f-skill');
  SKILLS.forEach(function (sk) {
    var o = document.createElement('option');
    o.value = sk.name;
    o.textContent = sk.name + ' (' + abilityByKey(sk.ability).short + ')';
    skill.appendChild(o);
  });

  var sv = document.getElementById('f-save');
  ABILITIES.forEach(function (a) {
    var o = document.createElement('option');
    o.value = a.key; o.textContent = a.name;
    sv.appendChild(o);
  });
}

function buildRollTypes() {
  var box = document.getElementById('roll-types');
  ROLL_TYPES.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.name;
    b.setAttribute('aria-pressed', String(t.id === roll.type));
    b.addEventListener('click', function () { setType(t.id); });
    box.appendChild(b);
  });
}

function buildModes() {
  var box = document.getElementById('w-modes');
  ROLL_MODES.forEach(function (m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.name;
    b.setAttribute('aria-pressed', String(m.id === roll.mode));
    b.addEventListener('click', function () {
      roll.mode = m.id;
      refreshPressed(box, m.id);
    });
    box.appendChild(b);
  });
}

function refreshPressed(box, activeId) {
  var list = (box.id === 'w-modes') ? ROLL_MODES : ROLL_TYPES;
  var buttons = box.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].setAttribute('aria-pressed', String(list[i].id === activeId));
  }
}

/* Зброя */

function renderWeapons() {
  var box = document.getElementById('weapons');
  box.innerHTML = '';
  state.weapons.forEach(function (w) {
    var el = document.createElement('div');
    el.className = 'weapon';
    el.innerHTML =
      '<div class="weapon-head">' +
        '<div class="field"><label>Название</label>' +
        '<input type="text" data-w="name" maxlength="30" placeholder="Короткий меч"></div>' +
        '<button type="button" class="link-btn" data-w="remove">удалить</button>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label>Параметр атаки</label><select data-w="ability">' +
          '<option value="str">Сила</option><option value="dex">Ловкость</option></select></div>' +
        '<div class="field"><label>Кубик урона</label>' +
        '<input type="text" data-w="dice" maxlength="20" placeholder="1d6"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label>Тип урона</label>' +
        '<input type="text" data-w="type" maxlength="20" placeholder="рубящий"></div>' +
        '<label class="check"><input type="checkbox" data-w="prof"> владение</label>' +
      '</div>' +
      '<p class="err" data-w="err"></p>';

    el.querySelector('[data-w="name"]').value = w.name;
    el.querySelector('[data-w="ability"]').value = w.ability;
    el.querySelector('[data-w="dice"]').value = w.dice;
    el.querySelector('[data-w="type"]').value = w.type;
    el.querySelector('[data-w="prof"]').checked = w.prof;

    el.querySelector('[data-w="name"]').addEventListener('input', function () {
      w.name = this.value; renderWeaponSelect(); updateComputed(); save();
    });
    el.querySelector('[data-w="ability"]').addEventListener('change', function () {
      w.ability = this.value; updateComputed(); save();
    });
    el.querySelector('[data-w="type"]').addEventListener('input', function () {
      w.type = this.value; save();
    });
    el.querySelector('[data-w="prof"]').addEventListener('change', function () {
      w.prof = this.checked; updateComputed(); save();
    });
    el.querySelector('[data-w="dice"]').addEventListener('input', function () {
      w.dice = this.value;
      var errBox = el.querySelector('[data-w="err"]');
      try {
        parseFormula(w.dice);
        errors['wdice-' + w.id] = null;
        errBox.textContent = '';
        this.classList.remove('invalid');
      } catch (e) {
        errors['wdice-' + w.id] = e.message;
        errBox.textContent = e.message;
        this.classList.add('invalid');
      }
      renderWeaponSelect(); updateRollButton(); save();
    });
    el.querySelector('[data-w="remove"]').addEventListener('click', function () {
      var idx = state.weapons.indexOf(w);
      if (idx !== -1) state.weapons.splice(idx, 1);
      delete errors['wdice-' + w.id];
      renderWeapons(); renderWeaponSelect(); updateComputed(); updateRollButton(); save();
    });

    box.appendChild(el);
  });
  document.getElementById('weapon-count').textContent = String(state.weapons.length);
  document.getElementById('add-weapon').disabled = state.weapons.length >= 10;
}

function renderWeaponSelect() {
  var sel = document.getElementById('f-weapon');
  sel.innerHTML = '';
  state.weapons.forEach(function (w) {
    var o = document.createElement('option');
    o.value = String(w.id);
    o.textContent = (w.name || 'без названия') + ' - ' + (w.dice || '?');
    sel.appendChild(o);
  });
  if (roll.type === 'damage') {
    var own = document.createElement('option');
    own.value = DAMAGE_OWN;
    own.textContent = 'своя формула';
    sel.appendChild(own);
  }
  if (!state.weapons.length && roll.type !== 'damage') {
    var none = document.createElement('option');
    none.value = '';
    none.textContent = 'нет оружия';
    sel.appendChild(none);
  }

  var ids = state.weapons.map(function (w) { return String(w.id); });
  var want = (roll.weaponId === null) ? null : String(roll.weaponId);

  if (want === DAMAGE_OWN && roll.type === 'damage') {
    sel.value = DAMAGE_OWN;
  } else if (want !== null && ids.indexOf(want) !== -1) {
    sel.value = want;
  } else if (state.weapons.length) {
    roll.weaponId = state.weapons[0].id;
    sel.value = String(roll.weaponId);
  } else {
    roll.weaponId = (roll.type === 'damage') ? DAMAGE_OWN : null;
    sel.value = (roll.weaponId === null) ? '' : DAMAGE_OWN;
  }

  setError('weapon', (roll.type === 'weapon' && !state.weapons.length)
    ? 'Добавьте оружие на листе персонажа' : null);
}

/* Перерахунок відображуваних величин */

function updateComputed() {
  ABILITIES.forEach(function (a) {
    document.getElementById('mod-' + a.key).textContent = signed(mod(a.key));
    document.getElementById('sv-bonus-' + a.key).textContent = signed(saveBonus(a.key));
  });
  SKILLS.forEach(function (sk, i) {
    document.getElementById('sk-bonus-' + i).textContent = signed(skillBonus(sk));
  });

  document.getElementById('out-prof').textContent = signed(prof());
  var dc = spellDC();
  document.getElementById('out-spell-dc').textContent = (dc === null) ? '-' : String(dc);

  document.getElementById('bonus-value').textContent = signed(currentBonus());
}

function currentBonus() {
  switch (roll.type) {
    case 'skill':  return skillBonus(skillByName(roll.skill));
    case 'save':   return saveBonus(roll.save);
    case 'init':   return mod('dex');
    case 'weapon': var w = currentWeapon(); return w ? weaponBonus(w) : 0;
    case 'spell':  return spellAttackBonus();
    default:       return 0;
  }
}

function show(id, visible) { document.getElementById(id).hidden = !visible; }

function updateVisibility() {
  var t = typeInfo();
  var isDamage = (t.id === 'damage');
  var ownFormula = isDamage && roll.weaponId === DAMAGE_OWN;
  var spellOff = (t.id === 'spell' && state.spellAbility === 'none');

  show('w-skill',      t.id === 'skill');
  show('w-save',       t.id === 'save');
  show('w-weapon',     t.id === 'weapon' || isDamage);
  show('w-formula',    t.id === 'formula' || ownFormula);
  show('w-crit',       isDamage);
  show('w-spell-note', spellOff);
  show('w-bonus',      t.d20 && !spellOff);
  show('w-modes',      t.d20);
  show('w-target',     !!t.target);

  document.getElementById('target-label').textContent =
    (t.target === 'ac') ? 'КЗ цели (необязательно)' : 'DC (необязательно)';
}

function setType(id) {
  roll.type = id;
  refreshPressed(document.getElementById('roll-types'), id);
  hideResult();                      /* старий результат очищається */
  setError('formula', null);
  document.querySelector('#w-formula input').classList.remove('invalid');
  renderWeaponSelect();
  updateVisibility();
  updateComputed();
  updateRollButton();
}

/* Кидок */

function readTarget() {
  var el = document.getElementById('f-target');
  if (el.value.trim() === '') return null;      /* поле необов'язкове */
  return parseInt(el.value, 10);
}

function makeEntry(title, total, verdict, kind, detail) {
  var now = new Date();
  var hh = ('0' + now.getHours()).slice(-2);
  var mm = ('0' + now.getMinutes()).slice(-2);
  return { time: hh + ':' + mm, title: title, total: total, verdict: verdict, kind: kind, detail: detail };
}

function rollCheck(t) {
  var bonus = 0, title = '';

  if (t.id === 'skill') {
    var sk = skillByName(roll.skill);
    bonus = skillBonus(sk); title = sk.name;
  } else if (t.id === 'save') {
    bonus = saveBonus(roll.save); title = 'Спасбросок: ' + abilityByKey(roll.save).name;
  } else if (t.id === 'init') {
    bonus = mod('dex'); title = 'Инициатива';        /* бонус майстерності не додається */
  } else if (t.id === 'weapon') {
    var w = currentWeapon();
    if (!w) { setError('weapon', 'Добавьте оружие на листе персонажа'); updateRollButton(); return null; }
    bonus = weaponBonus(w); title = 'Атака: ' + (w.name || 'без названия');
  } else if (t.id === 'spell') {
    if (state.spellAbility === 'none') return null;
    bonus = spellAttackBonus(); title = 'Атака заклинанием';
  }

  var r = rollD20(roll.mode);
  var total = r.value + bonus;
  var target = readTarget();
  var isAttack = (t.id === 'weapon' || t.id === 'spell');
  var verdict = null, kind = '';

  if (isAttack && r.isCrit) {                        /* з КЗ не порівнюємо */
    verdict = 'Критическое попадание'; kind = 'crit';
  } else if (isAttack && r.isFumble) {
    verdict = 'Промах'; kind = 'bad';
  } else if (target !== null) {                      /* порівняння з цільовим числом */
    var hit = total > target;
    verdict = isAttack ? (hit ? 'Попадание' : 'Промах') : (hit ? 'Успех' : 'Провал');
    kind = hit ? 'ok' : 'bad';
  }

  /* Цільове число показуємо в розкладці завжди, коли воно заповнене,
     зокрема при криті та автопромаху. На вердикт у цих двох випадках воно не впливає. */
  var detail = d20Text(r) + ' ' + signed(bonus) + ' = ' + num(total);
  if (target !== null) {
    detail += ' vs ' + (t.target === 'ac' ? 'КЗ ' : 'DC ') + target;
  }
  if (roll.mode === 'adv') title += ' (преимущество)';
  if (roll.mode === 'dis') title += ' (помеха)';

  return makeEntry(title, total, verdict, kind, detail);
}

function rollDamage() {
  var terms, title, abilityMod = 0;

  if (roll.weaponId === DAMAGE_OWN) {
    terms = parseFormula(document.getElementById('f-formula').value);
    title = 'Урон по формуле';
  } else {
    var w = currentWeapon();
    if (!w) {
      setError('weapon', 'Укажите оружие или выберите "своя формула"');
      updateRollButton();
      return null;
    }
    terms = parseFormula(w.dice);
    abilityMod = mod(w.ability);
    title = 'Урон: ' + (w.name || 'без названия');
  }

  var res = rollFormula(terms, false);
  var raw = res.total + abilityMod;
  if (roll.crit) raw = raw * 2;                      /* критичне влучання */
  var total = raw;

  var detail = res.text + (abilityMod !== 0 ? ' ' + signed(abilityMod) : '');
  if (roll.crit) detail = '2 × (' + detail + ')';
  detail += ' = ' + num(total);
  if (roll.crit) title += ' (крит)';

  return makeEntry(title, total, roll.crit ? 'Критический урон' : null, roll.crit ? 'crit' : '', detail);
}

function rollFreeFormula() {
  var terms = parseFormula(document.getElementById('f-formula').value);
  var res = rollFormula(terms, false);
  return makeEntry('Формула', res.total, null, '', res.text + ' = ' + num(res.total));
}

function doRoll() {
  if (blocked()) return;
  var t = typeInfo();
  var entry;

  try {
    if (t.id === 'damage')       entry = rollDamage();
    else if (t.id === 'formula') entry = rollFreeFormula();
    else                         entry = rollCheck(t);
  } catch (e) {
    if (e instanceof FormulaError) {
      setError('formula', e.message);
      document.querySelector('#w-formula input').classList.add('invalid');
      updateRollButton();
      return;
    }
    throw e;
  }
  if (!entry) return;

  showResult(entry);
  state.history.unshift(entry);
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
  renderHistory();
  save();
}

/* Виведення результату та історії */

function showResult(e) {
  var box = document.getElementById('result');
  box.hidden = false;
  box.className = 'result' + (e.kind ? ' is-' + e.kind : '');
  document.getElementById('result-total').textContent = num(e.total);
  document.getElementById('result-verdict').textContent = e.verdict || '';
  document.getElementById('result-detail').textContent = e.detail;
}

function hideResult() {
  document.getElementById('result').hidden = true;
}

function renderHistory() {
  var list = document.getElementById('history');
  list.innerHTML = '';
  document.getElementById('history-empty').hidden = state.history.length > 0;

  state.history.forEach(function (e) {
    var li = document.createElement('li');
    var time = document.createElement('span');
    time.className = 'h-time'; time.textContent = e.time;
    var title = document.createElement('span');
    title.className = 'h-title'; title.textContent = e.title;
    var detail = document.createElement('span');
    detail.className = 'h-detail'; detail.textContent = e.detail;
    li.appendChild(time); li.appendChild(title); li.appendChild(detail);
    if (e.verdict) {
      var v = document.createElement('span');
      v.className = 'h-verdict ' + (e.kind || '');
      v.textContent = e.verdict;
      li.appendChild(v);
    }
    list.appendChild(li);
  });
}

/* Синхронізація полів і події */

function syncInputs() {
  document.getElementById('f-name').value = state.name;
  NUM_FIELDS.forEach(function (f) {
    document.getElementById(f.id).value = String(state[f.key]);
    document.getElementById(f.id).classList.remove('invalid');
    setError(f.key, null);
  });
  ABILITIES.forEach(function (a) {
    var el = document.getElementById('ab-' + a.key);
    el.value = String(state.abilities[a.key]);
    el.classList.remove('invalid');
    document.getElementById('sv-' + a.key).checked = state.saves[a.key];
  });
  setError('abilities', null);
  SKILLS.forEach(function (sk, i) {
    document.getElementById('sk-' + i).checked = state.skills[sk.name];
  });
  document.getElementById('f-spell').value = state.spellAbility;
  document.getElementById('f-skill').value = roll.skill;
  document.getElementById('f-save').value = roll.save;
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  document.getElementById('theme-toggle').textContent =
    (state.theme === 'dark') ? 'Светлая тема' : 'Тёмная тема';
}

function syncAll() {
  syncInputs();
  renderWeapons();
  renderWeaponSelect();
  updateVisibility();
  updateComputed();
  renderHistory();
  applyTheme();
  updateRollButton();
}

function wireEvents() {
  document.getElementById('f-name').addEventListener('input', function () {
    state.name = this.value; save();
  });

  NUM_FIELDS.forEach(function (f) {
    document.getElementById(f.id).addEventListener('input', function () {
      var raw = digitsOnly(this);
      var n = parseInt(raw, 10);
      if (raw === '' || isNaN(n) || n < f.min || n > f.max) {
        this.classList.add('invalid');
        setError(f.key, f.msg);
      } else {
        this.classList.remove('invalid');
        setError(f.key, null);
        state[f.key] = n;
        save();
      }
      updateComputed();
      updateRollButton();
    });
  });

  document.getElementById('f-spell').addEventListener('change', function () {
    state.spellAbility = this.value;
    updateVisibility(); updateComputed(); save();
  });

  document.getElementById('f-skill').addEventListener('change', function () {
    roll.skill = this.value; hideResult(); updateComputed();
  });
  document.getElementById('f-save').addEventListener('change', function () {
    roll.save = this.value; hideResult(); updateComputed();
  });
  document.getElementById('f-weapon').addEventListener('change', function () {
    roll.weaponId = (this.value === DAMAGE_OWN) ? DAMAGE_OWN
                  : (this.value === '' ? null : parseInt(this.value, 10));
    hideResult(); updateVisibility(); updateComputed(); updateRollButton();
  });
  document.getElementById('f-crit').addEventListener('change', function () {
    roll.crit = this.checked;
  });

  var formula = document.getElementById('f-formula');
  formula.addEventListener('input', function () {
    if (this.value.trim() === '') {
      setError('formula', null); this.classList.remove('invalid');
    } else {
      try {
        parseFormula(this.value);
        setError('formula', null); this.classList.remove('invalid');
      } catch (e) {
        setError('formula', e.message); this.classList.add('invalid');
      }
    }
    updateRollButton();
  });
  formula.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); doRoll(); }
  });

  document.getElementById('f-target').addEventListener('input', function () {
    var raw = digitsOnly(this);
    if (raw === '') {
      this.classList.remove('invalid'); setError('target', null);
    } else {
      var n = parseInt(raw, 10);
      if (isNaN(n) || n < 1 || n > 99) {
        this.classList.add('invalid'); setError('target', 'Целевое число должно быть от 1 до 99');
      } else {
        this.classList.remove('invalid'); setError('target', null);
      }
    }
    updateRollButton();
  });

  document.getElementById('add-weapon').addEventListener('click', function () {
    if (state.weapons.length >= 10) return;
    state.weapons.push({ id: weaponSeq++, name: '', ability: 'str', prof: true, dice: '1d6', type: '' });
    renderWeapons(); renderWeaponSelect(); updateComputed(); updateRollButton(); save();
  });

  document.getElementById('roll').addEventListener('click', doRoll);

  document.getElementById('reset-character').addEventListener('click', function () {
    if (!window.confirm('Сбросить персонажа? Лист и история будут очищены.')) return;
    var theme = state.theme;
    state = defaultState();
    state.theme = theme;
    errors = {};
    roll.weaponId = null;
    hideResult();
    syncAll();
  });

  document.getElementById('clear-history').addEventListener('click', function () {
    if (!state.history.length) return;
    if (!window.confirm('Очистить историю бросков?')) return;
    state.history = [];
    renderHistory();
    save();
  });

  document.getElementById('theme-toggle').addEventListener('click', function () {
    state.theme = (state.theme === 'dark') ? 'light' : 'dark';
    applyTheme(); save();
  });
}

/* Старт */

state = load();
buildAbilities();
buildChecklists();
buildSelects();
buildRollTypes();
buildModes();
wireEvents();
syncAll();

})();
