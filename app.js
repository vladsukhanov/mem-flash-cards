'use strict';

/* ============================================================
 * 1. ХРАНИЛИЩЕ
 * Модель карточки уже готова к будущей синхронизации:
 *   id         - UUID (не автоинкремент, чтобы два устройства не конфликтовали)
 *   updatedAt  - время последнего изменения (для правила "last write wins")
 *   deleted    - мягкое удаление (флаг вместо физического удаления)
 * ============================================================ */
const STORAGE_KEY = 'mfc.cards';
const DAY = 24 * 60 * 60 * 1000;

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    console.error('Не удалось прочитать хранилище', e);
    return [];
  }
}

function saveCards() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

let cards = loadCards();

function newCard(front, back, example) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    front, back, example,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    // состояние повторения (упрощённый SM-2)
    due: now,        // когда показать в следующий раз
    interval: 0,     // текущий интервал в днях
    ease: 2.5,       // коэффициент лёгкости
    reps: 0          // сколько раз подряд вспомнили
  };
}

const activeCards = () => cards.filter(c => !c.deleted);

/* ============================================================
 * 2. АЛГОРИТМ ИНТЕРВАЛЬНЫХ ПОВТОРЕНИЙ (упрощённый SM-2)
 * grade: 0 = не помню, 1 = трудно, 2 = хорошо, 3 = легко
 * ============================================================ */
function applyGrade(card, grade) {
  const now = Date.now();

  if (grade === 0) {
    card.reps = 0;
    card.interval = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.due = now + 10 * 60 * 1000; // повторить через 10 минут
  } else {
    if (card.reps === 0) card.interval = 1;
    else if (card.reps === 1) card.interval = grade === 1 ? 2 : 4;
    else card.interval = Math.round(card.interval * card.ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1));

    if (grade === 1) card.ease = Math.max(1.3, card.ease - 0.15);
    if (grade === 3) card.ease += 0.15;

    card.reps += 1;
    card.due = now + Math.max(1, card.interval) * DAY;
  }
  card.updatedAt = now;
}

/* ============================================================
 * 3. ЭКРАН ПОВТОРЕНИЯ
 * ============================================================ */
const $ = id => document.getElementById(id);
let current = null;

function dueCards() {
  const now = Date.now();
  return activeCards().filter(c => c.due <= now).sort((a, b) => a.due - b.due);
}

function showNext() {
  const queue = dueCards();
  $('counter').textContent = queue.length ? `К повторению: ${queue.length}` : '';
  current = queue[0] || null;

  $('card').hidden = !current;
  $('flip').hidden = !current;
  $('grades').hidden = true;
  $('card-back').hidden = true;
  $('empty').hidden = !!current;

  if (current) {
    $('card-front').textContent = current.front;
    $('card-answer').textContent = current.back;
    $('card-example').textContent = current.example || '';
  }
}

$('flip').addEventListener('click', () => {
  $('card-back').hidden = false;
  $('flip').hidden = true;
  $('grades').hidden = false;
});

$('grades').addEventListener('click', e => {
  const btn = e.target.closest('button[data-grade]');
  if (!btn || !current) return;
  applyGrade(current, Number(btn.dataset.grade));
  saveCards();
  showNext();
});

/* ============================================================
 * 4. ДОБАВЛЕНИЕ
 * ============================================================ */
$('add-form').addEventListener('submit', e => {
  e.preventDefault();
  const front = $('f-front').value.trim();
  const back = $('f-back').value.trim();
  const example = $('f-example').value.trim();
  if (!front || !back) return;

  cards.push(newCard(front, back, example));
  saveCards();
  e.target.reset();
  $('f-front').focus();
  $('add-msg').textContent = `Сохранено: ${front}`;
});

/* ============================================================
 * 5. СПИСОК, ПОИСК, ЭКСПОРТ / ИМПОРТ
 * ============================================================ */
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('cards-list');
  ul.textContent = '';

  activeCards()
    .filter(c => !q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(c => {
      const li = document.createElement('li');

      const text = document.createElement('div');
      const front = document.createElement('div');
      front.textContent = c.front;
      const back = document.createElement('div');
      back.className = 'back';
      back.textContent = c.back;
      text.append(front, back);

      const del = document.createElement('button');
      del.textContent = 'Удалить';
      del.addEventListener('click', () => {
        if (!confirm(`Удалить «${c.front}»?`)) return;
        c.deleted = true;          // мягкое удаление
        c.updatedAt = Date.now();
        saveCards();
        renderList();
      });

      li.append(text, del);
      ul.append(li);
    });
}

$('search').addEventListener('input', renderList);

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flashcards-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error('Ожидался массив карточек');

    // Слияние по id: побеждает запись с более поздним updatedAt
    const byId = new Map(cards.map(c => [c.id, c]));
    for (const c of incoming) {
      if (!c.id || !c.front || !c.back) continue;
      const existing = byId.get(c.id);
      if (!existing || c.updatedAt > existing.updatedAt) byId.set(c.id, c);
    }
    cards = [...byId.values()];
    saveCards();
    renderList();
    alert('Импорт завершён');
  } catch (err) {
    alert('Не удалось импортировать файл: ' + err.message);
  }
  e.target.value = '';
});

/* ============================================================
 * 6. НАВИГАЦИЯ МЕЖДУ ЭКРАНАМИ
 * ============================================================ */
document.querySelector('nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;

  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== btn.dataset.view; });

  if (btn.dataset.view === 'study') showNext();
  if (btn.dataset.view === 'list') renderList();
  if (btn.dataset.view === 'add') { $('add-msg').textContent = ''; $('f-front').focus(); }
});

showNext();
