const phrases = [
  {
    phrase: 'An Apple a day',
    difficulty: {
      "easy": ['apple'],
      "medium": ['apple', 'day'],
      "hard": ['apple', 'day', 'doctor']
    }
  },
  {
    phrase: 'Early bird catches the worm',
    difficulty: {
      easy: ['bird', 'worm'],
      medium: ['bird', 'worm', 'catches', 'early'],
      hard: ['bird', 'worm', 'catches', 'early'],
    }
  }
];

export function getPhrases() {
  return phrases;
}
