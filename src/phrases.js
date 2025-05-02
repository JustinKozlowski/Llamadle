const phrases = [
  {
    phrase: 'Early bird catches the worm',
    difficulty: {
      easy: ['bird', 'worm'],
      medium: ['bird', 'worm', 'catches', 'early'],
      hard: ['bird', 'worm', 'catches', 'early'],
    }
  },
  {
    phrase: 'An Apple a day',
    difficulty: {
      "easy": ['apple'],
      "medium": ['apple', 'day'],
      "hard": ['apple', 'day', 'doctor']
    }
  },
];

export function getPhrases() {
  return phrases;
}
