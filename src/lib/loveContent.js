/**
 * Words for Flick for lovers: today's question, moods and "open when" letters.
 *
 * Today's answer and the letters are ordinary chat messages with a type in their metadata (like
 * love signals), so they reach the other phone offline-first, by push and on Flick Web:
 *   { type: 'daily_answer', day: 'YYYY-MM-DD', question }   text: the question and my answer
 *   { type: 'open_when', title, letter }                     text: "💌 A letter for you: Open when …"
 */

export const DAILY_ANSWER = 'daily_answer';
export const OPEN_WHEN = 'open_when';

export const DAILY_QUESTIONS = [
  'What small thing do I do that always makes you smile?',
  'What was your first thought when you saw me?',
  'Which day with me would you live again?',
  'What song makes you think of us?',
  'Where should our next trip be?',
  'What do you love most about how we talk?',
  'What is something new you want us to try together?',
  'Which of my habits secretly makes you happy?',
  'What do you miss most when we are apart?',
  'What made you laugh this week?',
  'What is your favourite photo of us, and why?',
  'What is one thing you want to tell me but never said?',
  'What would our perfect lazy Sunday look like?',
  'Which food will always remind you of me?',
  'What is a dream you want us to chase together?',
  'When did you know this was special?',
  'What should we celebrate this month?',
  'What is the sweetest message I ever sent you?',
  'What is one thing I can do for you this week?',
  'Which movie should we watch together next?',
  'What does home feel like to you?',
  'What are you most proud of about us?',
  'What would you write in a letter to us in ten years?',
  'Which little moment from today do you want to share?',
  'What do you want our next date to be?',
  'What nickname should I call you that I never have?',
  'What do I do that makes you feel safe?',
  'What is something you learned from me?',
  'If we had a whole free day tomorrow, what would we do?',
  'What is your favourite memory from the start of us?',
];

/** The same question for both of us on the same day. */
export function questionOfDay(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return DAILY_QUESTIONS[((day % DAILY_QUESTIONS.length) + DAILY_QUESTIONS.length) % DAILY_QUESTIONS.length];
}

export const dailyAnswerText = (question, answer) => `💬 ${question}\n${answer}`;

/** The answer part of a daily_answer message (the text after the question line). */
export function answerOf(message) {
  const text = String(message?.text || '');
  const nl = text.indexOf('\n');
  return nl >= 0 ? text.slice(nl + 1).trim() : text.replace(/^💬\s*/, '').trim();
}

export const MOODS = [
  { id: 'happy', emoji: '😊', label: 'Happy' },
  { id: 'missing', emoji: '🥺', label: 'Missing you' },
  { id: 'love', emoji: '😍', label: 'In love' },
  { id: 'excited', emoji: '🤩', label: 'Excited' },
  { id: 'tired', emoji: '😴', label: 'Tired' },
  { id: 'busy', emoji: '💼', label: 'Busy' },
  { id: 'sad', emoji: '🥲', label: 'A bit low' },
  { id: 'calm', emoji: '😌', label: 'Calm' },
];

/** "🥺 Missing you" for a stored mood (the label is what the server keeps). */
export function moodText(mood) {
  if (!mood) return null;
  const m = MOODS.find((x) => x.label === mood || x.id === mood);
  return m ? `${m.emoji} ${m.label}` : mood;
}

export const OPEN_WHEN_TITLES = [
  'you miss me',
  "you can't sleep",
  'you need a smile',
  "you're having a bad day",
  'you feel proud of yourself',
  'it is our anniversary',
];

export const openWhenText = (title) => `💌 A letter for you: Open when ${title}`;
