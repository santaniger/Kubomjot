/* Довідники предметної області.
   Джерело: "Правила для начинающих" (dungeonsanddragons.ru). */

var ABILITIES = [
  { key: 'str', name: 'Сила',         short: 'Сил' },
  { key: 'dex', name: 'Ловкость',     short: 'Лов' },
  { key: 'con', name: 'Телосложение', short: 'Тел' },
  { key: 'int', name: 'Интеллект',    short: 'Инт' },
  { key: 'wis', name: 'Мудрость',     short: 'Муд' },
  { key: 'cha', name: 'Харизма',      short: 'Хар' }
];

/* 18 навичок. Порядок і прив'язка до характеристик збережені з джерела */
var SKILLS = [
  { name: 'Атлетика',           ability: 'str' },
  { name: 'Акробатика',         ability: 'dex' },
  { name: 'Ловкость рук',       ability: 'dex' },
  { name: 'Скрытность',         ability: 'str' },
  { name: 'Анализ',             ability: 'int' },
  { name: 'История',            ability: 'int' },
  { name: 'Магия',              ability: 'int' },
  { name: 'Природа',            ability: 'int' },
  { name: 'Религия',            ability: 'int' },
  { name: 'Внимательность',     ability: 'wis' },
  { name: 'Выживание',          ability: 'wis' },
  { name: 'Медицина',           ability: 'wis' },
  { name: 'Проницательность',   ability: 'wis' },
  { name: 'Уход за животными',  ability: 'wis' },
  { name: 'Выступление',        ability: 'cha' },
  { name: 'Запугивание',        ability: 'cha' },
  { name: 'Обман',              ability: 'cha' },
  { name: 'Убеждение',          ability: 'cha' }
];

/* Характеристики, які можуть відповідати за магію */
var SPELL_ABILITIES = ['int', 'wis', 'cha'];

/* Типи кидків.
   d20    - кидок двадцятигранника, тож доступні перевага і завада;
   target - яке цільове число запитується: 'dc', 'ac' або null. */
var ROLL_TYPES = [
  { id: 'skill',   name: 'Навык',                d20: true,  target: 'dc' },
  { id: 'save',    name: 'Спасбросок',           d20: true,  target: 'dc' },
  { id: 'init',    name: 'Инициатива',           d20: true,  target: null },
  { id: 'weapon',  name: 'Атака оружием',        d20: true,  target: 'ac' },
  { id: 'spell',   name: 'Атака заклинанием',    d20: true,  target: 'ac' },
  { id: 'damage',  name: 'Урон',                 d20: false, target: null },
  { id: 'formula', name: 'Произвольная формула', d20: false, target: null }
];

var ROLL_MODES = [
  { id: 'normal', name: 'Обычный' },
  { id: 'adv',    name: 'Преимущество' },
  { id: 'dis',    name: 'Помеха' }
];
