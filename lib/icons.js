// The goal icons Deka may choose from, one shared list for the server checks, the
// sprite build and the app. Each key maps to a Phosphor icon (MIT) and the
// category and scheduling tags a goal with that icon most likely has.

const CATEGORIES = ['body', 'people', 'fun', 'work', 'mind', 'rest'];

// key: [phosphor name, category, energy, social, fun, time of day, weekend leaning]
const ICONS = {
  run: ['person-simple-run', 'body', 'heavy', 'no', 'no', 'any', 'no'],
  gym: ['barbell', 'body', 'heavy', 'no', 'no', 'any', 'no'],
  walk: ['person-simple-walk', 'body', 'light', 'no', 'no', 'any', 'no'],
  yoga: ['person-simple-tai-chi', 'body', 'light', 'no', 'no', 'any', 'no'],
  bike: ['bicycle', 'body', 'heavy', 'no', 'no', 'any', 'no'],
  swim: ['person-simple-swim', 'body', 'heavy', 'no', 'no', 'any', 'no'],
  hike: ['mountains', 'body', 'heavy', 'no', 'yes', 'day', 'yes'],
  sport: ['soccer-ball', 'body', 'heavy', 'yes', 'yes', 'any', 'no'],
  water: ['drop', 'body', 'light', 'no', 'no', 'any', 'no'],
  pill: ['pill', 'body', 'light', 'no', 'no', 'morning', 'no'],
  dog: ['dog', 'body', 'light', 'no', 'no', 'any', 'no'],
  family: ['heart', 'people', 'light', 'yes', 'no', 'any', 'no'],
  friends: ['users-three', 'people', 'light', 'yes', 'yes', 'evening', 'yes'],
  call: ['phone', 'people', 'light', 'yes', 'no', 'any', 'no'],
  chat: ['chat-circle', 'people', 'light', 'yes', 'no', 'any', 'no'],
  coffee: ['coffee', 'people', 'light', 'yes', 'no', 'day', 'no'],
  baby: ['baby', 'people', 'light', 'yes', 'no', 'any', 'no'],
  date: ['wine', 'fun', 'light', 'yes', 'yes', 'evening', 'yes'],
  party: ['confetti', 'fun', 'light', 'yes', 'yes', 'evening', 'yes'],
  drinks: ['beer-stein', 'fun', 'light', 'yes', 'yes', 'evening', 'yes'],
  music: ['music-notes', 'fun', 'light', 'no', 'no', 'evening', 'no'],
  headphones: ['headphones', 'fun', 'light', 'no', 'no', 'any', 'no'],
  guitar: ['guitar', 'fun', 'light', 'no', 'no', 'evening', 'no'],
  game: ['game-controller', 'fun', 'light', 'no', 'yes', 'evening', 'no'],
  movie: ['film-slate', 'fun', 'light', 'no', 'yes', 'evening', 'no'],
  camera: ['camera', 'fun', 'light', 'no', 'no', 'day', 'no'],
  travel: ['airplane', 'fun', 'heavy', 'no', 'yes', 'any', 'yes'],
  sparkle: ['sparkle', 'fun', 'light', 'no', 'yes', 'any', 'no'],
  laptop: ['laptop', 'work', 'heavy', 'no', 'no', 'any', 'no'],
  work: ['briefcase', 'work', 'heavy', 'no', 'no', 'day', 'no'],
  code: ['code', 'work', 'heavy', 'no', 'no', 'any', 'no'],
  money: ['coins', 'work', 'light', 'no', 'no', 'any', 'no'],
  cook: ['cooking-pot', 'work', 'light', 'no', 'no', 'evening', 'no'],
  clean: ['broom', 'work', 'light', 'no', 'no', 'any', 'no'],
  shop: ['shopping-cart', 'work', 'light', 'no', 'no', 'any', 'no'],
  home: ['house', 'work', 'light', 'no', 'no', 'any', 'no'],
  book: ['book-open', 'mind', 'light', 'no', 'no', 'evening', 'no'],
  write: ['pencil-simple', 'mind', 'heavy', 'no', 'no', 'any', 'no'],
  brain: ['brain', 'mind', 'heavy', 'no', 'no', 'any', 'no'],
  learn: ['graduation-cap', 'mind', 'heavy', 'no', 'no', 'any', 'no'],
  language: ['translate', 'mind', 'light', 'no', 'no', 'any', 'no'],
  art: ['paint-brush', 'mind', 'light', 'no', 'no', 'any', 'no'],
  puzzle: ['puzzle-piece', 'mind', 'light', 'no', 'no', 'any', 'no'],
  target: ['target', 'mind', 'light', 'no', 'no', 'any', 'no'],
  moon: ['moon', 'rest', 'light', 'no', 'no', 'evening', 'no'],
  bed: ['bed', 'rest', 'light', 'no', 'no', 'evening', 'no'],
  meditate: ['flower-lotus', 'rest', 'light', 'no', 'no', 'morning', 'no'],
  leaf: ['leaf', 'rest', 'light', 'no', 'no', 'any', 'no'],
  plant: ['plant', 'rest', 'light', 'no', 'no', 'any', 'no'],
  sun: ['sun', 'rest', 'light', 'no', 'no', 'morning', 'no'],
  phone_off: ['device-mobile-slash', 'rest', 'light', 'no', 'no', 'any', 'no'],
};

const ICON_KEYS = Object.keys(ICONS);

module.exports = { ICONS, ICON_KEYS, CATEGORIES };
