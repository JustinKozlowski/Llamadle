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
  {
    phrase: 'Second mouse gets the cheese',
    difficulty: {
      "easy": ['mouse'],
      "medium": ['mouse ', 'cheese'],
      "hard": ['second', 'mouse', 'cheese']
    }
  },
  {
    phrase: 'Out of left field',
    difficulty: {
      "easy": ['field'],
      "medium": ['out', 'field'],
      "hard": ['out', 'left', 'field']
    }
  },
];

export function getPhrases() {
  return phrases;
}
