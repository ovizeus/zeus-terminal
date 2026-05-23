'use strict';

/**
 * redactPipeline.js — Sub-C.1 Task 2
 *
 * Privacy guard for Omega long-term memory:
 *   1. Pre-save input redact (mode='input')
 *   2. Pre-LLM extraction (mode='input')
 *   3. Post-LLM output on each fact_value (mode='input')
 *   4. Reply path (mode='reply')
 *
 * mode='input' (high-recall): proximity-keyword presence triggers redact even
 *   without an exact secret value — losing context < leaking secrets.
 *
 * mode='reply' (high-precision): requires exact regex match only. Proximity
 *   keyword alone does NOT redact — prevents false positives in natural language.
 */

// ─────────────────────────────────────────────────────────────────────────────
// BIP39 English Wordlist — 2048 words (standard, public domain)
// Source: https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
// ─────────────────────────────────────────────────────────────────────────────

const BIP39_WORDS = new Set([
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
  'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
  'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
  'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
  'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
  'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
  'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
  'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
  'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume',
  'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
  'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado',
  'avoid', 'awake', 'aware', 'away', 'awesome', 'awful', 'awkward', 'axis',
  'baby', 'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball',
  'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base',
  'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become',
  'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt',
  'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle',
  'bid', 'bike', 'bind', 'biology', 'bird', 'birth', 'bitter', 'black',
  'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood',
  'blossom', 'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body',
  'boil', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring',
  'borrow', 'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain',
  'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge', 'brief',
  'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother',
  'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb',
  'bulk', 'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus',
  'business', 'busy', 'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable',
  'cactus', 'cage', 'cake', 'call', 'calm', 'camera', 'camp', 'can',
  'canal', 'cancel', 'candy', 'cannon', 'canoe', 'canvas', 'canyon', 'capable',
  'capital', 'captain', 'car', 'carbon', 'card', 'cargo', 'carpet', 'carry',
  'cart', 'case', 'cash', 'casino', 'castle', 'casual', 'cat', 'catalog',
  'catch', 'category', 'cattle', 'caught', 'cause', 'caution', 'cave', 'ceiling',
  'celery', 'cement', 'census', 'century', 'cereal', 'certain', 'chair', 'chalk',
  'champion', 'change', 'chaos', 'chapter', 'charge', 'chase', 'chat', 'cheap',
  'check', 'cheese', 'chef', 'cherry', 'chest', 'chicken', 'chief', 'child',
  'chimney', 'choice', 'choose', 'chronic', 'chuckle', 'chunk', 'churn', 'cigar',
  'cinnamon', 'circle', 'citizen', 'city', 'civil', 'claim', 'clap', 'clarify',
  'claw', 'clay', 'clean', 'clerk', 'clever', 'click', 'client', 'cliff',
  'climb', 'clinic', 'clip', 'clock', 'clog', 'close', 'cloth', 'cloud',
  'clown', 'club', 'clump', 'cluster', 'clutch', 'coach', 'coast', 'coconut',
  'code', 'coffee', 'coil', 'coin', 'collect', 'color', 'column', 'combine',
  'come', 'comfort', 'comic', 'common', 'company', 'concert', 'conduct', 'confirm',
  'congress', 'connect', 'consider', 'control', 'convince', 'cook', 'cool', 'copper',
  'copy', 'coral', 'core', 'corn', 'correct', 'cost', 'cotton', 'couch',
  'country', 'couple', 'course', 'cousin', 'cover', 'coyote', 'crack', 'cradle',
  'craft', 'cram', 'crane', 'crash', 'crater', 'crawl', 'crazy', 'cream',
  'credit', 'creek', 'crew', 'cricket', 'crime', 'crisp', 'critic', 'crop',
  'cross', 'crouch', 'crowd', 'crucial', 'cruel', 'cruise', 'crumble', 'crunch',
  'crush', 'cry', 'crystal', 'cube', 'culture', 'cup', 'cupboard', 'curious',
  'current', 'curtain', 'curve', 'cushion', 'custom', 'cute', 'cycle', 'dad',
  'damage', 'damp', 'dance', 'danger', 'daring', 'dash', 'daughter', 'dawn',
  'day', 'deal', 'debate', 'debris', 'decade', 'december', 'decide', 'decline',
  'decorate', 'decrease', 'deer', 'defense', 'define', 'defy', 'degree', 'delay',
  'deliver', 'demand', 'demise', 'denial', 'dentist', 'deny', 'depart', 'depend',
  'deposit', 'depth', 'deputy', 'derive', 'describe', 'desert', 'design', 'desk',
  'despair', 'destroy', 'detail', 'detect', 'develop', 'device', 'devote', 'diagram',
  'dial', 'diamond', 'diary', 'dice', 'diesel', 'diet', 'differ', 'digital',
  'dignity', 'dilemma', 'dinner', 'dinosaur', 'direct', 'dirt', 'disagree', 'discover',
  'disease', 'dish', 'dismiss', 'disorder', 'display', 'distance', 'divert', 'divide',
  'divorce', 'dizzy', 'doctor', 'document', 'dog', 'doll', 'dolphin', 'domain',
  'donate', 'donkey', 'donor', 'door', 'dose', 'double', 'dove', 'draft',
  'dragon', 'drama', 'drastic', 'draw', 'dream', 'dress', 'drift', 'drill',
  'drink', 'drip', 'drive', 'drop', 'drum', 'dry', 'duck', 'dumb',
  'dune', 'during', 'dust', 'dutch', 'duty', 'dwarf', 'dynamic', 'eager',
  'eagle', 'early', 'earn', 'earth', 'easily', 'east', 'easy', 'echo',
  'ecology', 'economy', 'edge', 'edit', 'educate', 'effort', 'egg', 'eight',
  'either', 'elbow', 'elder', 'electric', 'elegant', 'element', 'elephant', 'elevator',
  'elite', 'else', 'embark', 'embody', 'embrace', 'emerge', 'emotion', 'employ',
  'empower', 'empty', 'enable', 'enact', 'end', 'endless', 'endorse', 'enemy',
  'energy', 'enforce', 'engage', 'engine', 'enhance', 'enjoy', 'enlist', 'enough',
  'enrich', 'enroll', 'ensure', 'enter', 'entire', 'entry', 'envelope', 'episode',
  'equal', 'equip', 'era', 'erase', 'erode', 'erosion', 'error', 'erupt',
  'escape', 'essay', 'essence', 'estate', 'eternal', 'ethics', 'evidence', 'evil',
  'evoke', 'evolve', 'exact', 'example', 'excess', 'exchange', 'excite', 'exclude',
  'excuse', 'execute', 'exercise', 'exhaust', 'exhibit', 'exile', 'exist', 'exit',
  'exotic', 'expand', 'expect', 'expire', 'explain', 'expose', 'express', 'extend',
  'extra', 'eye', 'eyebrow', 'fabric', 'face', 'faculty', 'fade', 'faint',
  'faith', 'fall', 'false', 'fame', 'family', 'famous', 'fan', 'fancy',
  'fantasy', 'farm', 'fashion', 'fat', 'fatal', 'father', 'fatigue', 'fault',
  'favorite', 'feature', 'february', 'federal', 'fee', 'feed', 'feel', 'female',
  'fence', 'festival', 'fetch', 'fever', 'few', 'fiber', 'fiction', 'field',
  'figure', 'file', 'film', 'filter', 'final', 'find', 'fine', 'finger',
  'finish', 'fire', 'firm', 'first', 'fiscal', 'fish', 'fit', 'fitness',
  'fix', 'flag', 'flame', 'flash', 'flat', 'flavor', 'flee', 'flight',
  'flip', 'float', 'flock', 'floor', 'flower', 'fluid', 'flush', 'fly',
  'foam', 'focus', 'fog', 'foil', 'fold', 'follow', 'food', 'foot',
  'force', 'forest', 'forget', 'fork', 'fortune', 'forum', 'forward', 'fossil',
  'foster', 'found', 'fox', 'fragile', 'frame', 'frequent', 'fresh', 'friend',
  'fringe', 'frog', 'front', 'frost', 'frown', 'frozen', 'fruit', 'fuel',
  'fun', 'funny', 'furnace', 'fury', 'future', 'gadget', 'gain', 'galaxy',
  'gallery', 'game', 'gap', 'garage', 'garbage', 'garden', 'garlic', 'garment',
  'gas', 'gasp', 'gate', 'gather', 'gauge', 'gaze', 'general', 'genius',
  'genre', 'gentle', 'genuine', 'gesture', 'ghost', 'giant', 'gift', 'giggle',
  'ginger', 'giraffe', 'girl', 'give', 'glad', 'glance', 'glare', 'glass',
  'glide', 'glimpse', 'globe', 'gloom', 'glory', 'glove', 'glow', 'glue',
  'goat', 'goddess', 'gold', 'good', 'goose', 'gorilla', 'gospel', 'gossip',
  'govern', 'gown', 'grab', 'grace', 'grain', 'grant', 'grape', 'grass',
  'gravity', 'great', 'green', 'grid', 'grief', 'grit', 'grocery', 'group',
  'grow', 'grunt', 'guard', 'guess', 'guide', 'guilt', 'guitar', 'gun',
  'gym', 'habit', 'hair', 'half', 'hammer', 'hamster', 'hand', 'happy',
  'harbor', 'hard', 'harsh', 'harvest', 'hat', 'have', 'hawk', 'hazard',
  'head', 'health', 'heart', 'heavy', 'hedgehog', 'height', 'hello', 'helmet',
  'help', 'hen', 'hero', 'hidden', 'high', 'hill', 'hint', 'hip',
  'hire', 'history', 'hobby', 'hockey', 'hold', 'hole', 'holiday', 'hollow',
  'home', 'honey', 'hood', 'hope', 'horn', 'horror', 'horse', 'hospital',
  'host', 'hotel', 'hour', 'hover', 'hub', 'huge', 'human', 'humble',
  'humor', 'hundred', 'hungry', 'hunt', 'hurdle', 'hurry', 'hurt', 'husband',
  'hybrid', 'ice', 'icon', 'idea', 'identify', 'idle', 'ignore', 'ill',
  'illegal', 'illness', 'image', 'imitate', 'immense', 'immune', 'impact', 'impose',
  'improve', 'impulse', 'inch', 'include', 'income', 'increase', 'index', 'indicate',
  'indoor', 'industry', 'infant', 'inflict', 'inform', 'inhale', 'inherit', 'initial',
  'inject', 'injury', 'inmate', 'inner', 'innocent', 'input', 'inquiry', 'insane',
  'insect', 'inside', 'inspire', 'install', 'intact', 'interest', 'into', 'invest',
  'invite', 'involve', 'iron', 'island', 'isolate', 'issue', 'item', 'ivory',
  'jacket', 'jaguar', 'jar', 'jazz', 'jealous', 'jeans', 'jelly', 'jewel',
  'job', 'join', 'joke', 'journey', 'joy', 'judge', 'juice', 'jump',
  'jungle', 'junior', 'junk', 'just', 'kangaroo', 'keen', 'keep', 'ketchup',
  'key', 'kick', 'kid', 'kidney', 'kind', 'kingdom', 'kiss', 'kit',
  'kitchen', 'kite', 'kitten', 'kiwi', 'knee', 'knife', 'knock', 'know',
  'lab', 'label', 'labor', 'ladder', 'lady', 'lake', 'lamp', 'language',
  'laptop', 'large', 'later', 'latin', 'laugh', 'laundry', 'lava', 'law',
  'lawn', 'lawsuit', 'layer', 'lazy', 'leader', 'leaf', 'learn', 'leave',
  'lecture', 'left', 'leg', 'legal', 'legend', 'leisure', 'lemon', 'lend',
  'length', 'lens', 'leopard', 'lesson', 'letter', 'level', 'liar', 'liberty',
  'library', 'license', 'life', 'lift', 'light', 'like', 'limb', 'limit',
  'link', 'lion', 'liquid', 'list', 'little', 'live', 'lizard', 'load',
  'loan', 'lobster', 'local', 'lock', 'logic', 'lonely', 'long', 'loop',
  'lottery', 'loud', 'lounge', 'love', 'loyal', 'lucky', 'luggage', 'lumber',
  'lunar', 'lunch', 'luxury', 'lyrics', 'machine', 'mad', 'magic', 'magnet',
  'maid', 'mail', 'main', 'major', 'make', 'mammal', 'man', 'manage',
  'mandate', 'mango', 'mansion', 'manual', 'maple', 'marble', 'march', 'margin',
  'marine', 'market', 'marriage', 'mask', 'mass', 'master', 'match', 'material',
  'math', 'matrix', 'matter', 'maximum', 'maze', 'meadow', 'mean', 'measure',
  'meat', 'mechanic', 'medal', 'media', 'melody', 'melt', 'member', 'memory',
  'mention', 'menu', 'mercy', 'merge', 'merit', 'merry', 'mesh', 'message',
  'metal', 'method', 'middle', 'midnight', 'milk', 'million', 'mimic', 'mind',
  'minimum', 'minor', 'minute', 'miracle', 'mirror', 'misery', 'miss', 'mistake',
  'mix', 'mixed', 'mixture', 'mobile', 'model', 'modify', 'mom', 'moment',
  'monitor', 'monkey', 'monster', 'month', 'moon', 'moral', 'more', 'morning',
  'mosquito', 'mother', 'motion', 'motor', 'mountain', 'mouse', 'move', 'movie',
  'much', 'muffin', 'mule', 'multiply', 'muscle', 'museum', 'mushroom', 'music',
  'must', 'mutual', 'myself', 'mystery', 'myth', 'naive', 'name', 'napkin',
  'narrow', 'nasty', 'nation', 'nature', 'near', 'neck', 'need', 'negative',
  'neglect', 'neither', 'nephew', 'nerve', 'nest', 'net', 'network', 'neutral',
  'never', 'news', 'next', 'nice', 'night', 'noble', 'noise', 'nominee',
  'noodle', 'normal', 'north', 'nose', 'notable', 'note', 'nothing', 'notice',
  'novel', 'now', 'nuclear', 'number', 'nurse', 'nut', 'oak', 'obey',
  'object', 'oblige', 'obscure', 'observe', 'obtain', 'obvious', 'occur', 'ocean',
  'october', 'odor', 'off', 'offer', 'office', 'often', 'oil', 'okay',
  'old', 'olive', 'olympic', 'omit', 'once', 'one', 'onion', 'online',
  'only', 'open', 'opera', 'opinion', 'oppose', 'option', 'orange', 'orbit',
  'orchard', 'order', 'ordinary', 'organ', 'orient', 'original', 'orphan', 'ostrich',
  'other', 'outdoor', 'outer', 'output', 'outside', 'oval', 'oven', 'over',
  'own', 'owner', 'oxygen', 'oyster', 'ozone', 'pact', 'paddle', 'page',
  'pair', 'palace', 'palm', 'panda', 'panel', 'panic', 'panther', 'paper',
  'parade', 'parent', 'park', 'parrot', 'party', 'pass', 'patch', 'path',
  'patient', 'patrol', 'pattern', 'pause', 'pave', 'payment', 'peace', 'peanut',
  'pear', 'peasant', 'pelican', 'pen', 'penalty', 'pencil', 'people', 'pepper',
  'perfect', 'permit', 'person', 'pet', 'phone', 'photo', 'phrase', 'physical',
  'piano', 'picnic', 'picture', 'piece', 'pig', 'pigeon', 'pill', 'pilot',
  'pink', 'pioneer', 'pipe', 'pistol', 'pitch', 'pizza', 'place', 'planet',
  'plastic', 'plate', 'play', 'please', 'pledge', 'pluck', 'plug', 'plunge',
  'poem', 'poet', 'point', 'polar', 'pole', 'police', 'pond', 'pony',
  'pool', 'popular', 'portion', 'position', 'possible', 'post', 'potato', 'pottery',
  'poverty', 'powder', 'power', 'practice', 'praise', 'predict', 'prefer', 'prepare',
  'present', 'pretty', 'prevent', 'price', 'pride', 'primary', 'print', 'priority',
  'prison', 'private', 'prize', 'problem', 'process', 'produce', 'profit', 'program',
  'project', 'promote', 'proof', 'property', 'prosper', 'protect', 'proud', 'provide',
  'public', 'pudding', 'pull', 'pulp', 'pulse', 'pumpkin', 'punch', 'pupil',
  'puppy', 'purchase', 'purity', 'purpose', 'purse', 'push', 'put', 'puzzle',
  'pyramid', 'quality', 'quantum', 'quarter', 'question', 'quick', 'quit', 'quiz',
  'quote', 'rabbit', 'raccoon', 'race', 'rack', 'radar', 'radio', 'rail',
  'rain', 'raise', 'rally', 'ramp', 'ranch', 'random', 'range', 'rapid',
  'rare', 'rate', 'rather', 'raven', 'raw', 'razor', 'ready', 'real',
  'reason', 'rebel', 'rebuild', 'recall', 'receive', 'recipe', 'record', 'recycle',
  'reduce', 'reflect', 'reform', 'refuse', 'region', 'regret', 'regular', 'reject',
  'relax', 'release', 'relief', 'rely', 'remain', 'remember', 'remind', 'remove',
  'render', 'renew', 'rent', 'reopen', 'repair', 'repeat', 'replace', 'report',
  'require', 'rescue', 'resemble', 'resist', 'resource', 'response', 'result', 'retire',
  'retreat', 'return', 'reunion', 'reveal', 'review', 'reward', 'rhythm', 'rib',
  'ribbon', 'rice', 'rich', 'ride', 'ridge', 'rifle', 'right', 'rigid',
  'ring', 'riot', 'ripple', 'risk', 'ritual', 'rival', 'river', 'road',
  'roast', 'robot', 'robust', 'rocket', 'romance', 'roof', 'rookie', 'room',
  'rose', 'rotate', 'rough', 'round', 'route', 'royal', 'rubber', 'rude',
  'rug', 'rule', 'run', 'runway', 'rural', 'sad', 'saddle', 'sadness',
  'safe', 'sail', 'salad', 'salmon', 'salon', 'salt', 'salute', 'same',
  'sample', 'sand', 'satisfy', 'satoshi', 'sauce', 'sausage', 'save', 'say',
  'scale', 'scan', 'scare', 'scatter', 'scene', 'scheme', 'school', 'science',
  'scissors', 'scorpion', 'scout', 'scrap', 'screen', 'script', 'scrub', 'sea',
  'search', 'season', 'seat', 'second', 'secret', 'section', 'security', 'seed',
  'seek', 'segment', 'select', 'sell', 'seminar', 'senior', 'sense', 'sentence',
  'series', 'service', 'session', 'settle', 'setup', 'seven', 'shadow', 'shaft',
  'shallow', 'share', 'shed', 'shell', 'sheriff', 'shield', 'shift', 'shine',
  'ship', 'shiver', 'shock', 'shoe', 'shoot', 'shop', 'short', 'shoulder',
  'shove', 'shrimp', 'shrug', 'shuffle', 'shy', 'sibling', 'sick', 'side',
  'siege', 'sight', 'sign', 'silent', 'silk', 'silly', 'silver', 'similar',
  'simple', 'since', 'sing', 'siren', 'sister', 'situate', 'six', 'size',
  'skate', 'sketch', 'ski', 'skill', 'skin', 'skirt', 'skull', 'slab',
  'slam', 'sleep', 'slender', 'slice', 'slide', 'slight', 'slim', 'slogan',
  'slot', 'slow', 'slush', 'small', 'smart', 'smile', 'smoke', 'smooth',
  'snack', 'snake', 'snap', 'sniff', 'snow', 'soap', 'soccer', 'social',
  'sock', 'soda', 'soft', 'solar', 'soldier', 'solid', 'solution', 'solve',
  'someone', 'song', 'soon', 'sorry', 'sort', 'soul', 'sound', 'soup',
  'source', 'south', 'space', 'spare', 'spatial', 'spawn', 'speak', 'special',
  'speed', 'spell', 'spend', 'sphere', 'spice', 'spider', 'spike', 'spin',
  'spirit', 'split', 'spoil', 'sponsor', 'spoon', 'sport', 'spot', 'spray',
  'spread', 'spring', 'spy', 'square', 'squeeze', 'squirrel', 'stable', 'stadium',
  'staff', 'stage', 'stairs', 'stamp', 'stand', 'start', 'state', 'stay',
  'steak', 'steel', 'stem', 'step', 'stereo', 'stick', 'still', 'sting',
  'stock', 'stomach', 'stone', 'stool', 'story', 'stove', 'strategy', 'street',
  'strike', 'strong', 'struggle', 'student', 'stuff', 'stumble', 'style', 'subject',
  'submit', 'subway', 'success', 'such', 'sudden', 'suffer', 'sugar', 'suggest',
  'suit', 'summer', 'sun', 'sunny', 'sunset', 'super', 'supply', 'supreme',
  'sure', 'surface', 'surge', 'surprise', 'surround', 'survey', 'suspect', 'sustain',
  'swallow', 'swamp', 'swap', 'swarm', 'swear', 'sweet', 'swift', 'swim',
  'swing', 'switch', 'sword', 'symbol', 'symptom', 'syrup', 'system', 'table',
  'tackle', 'tag', 'tail', 'talent', 'talk', 'tank', 'tape', 'target',
  'task', 'taste', 'tattoo', 'taxi', 'teach', 'team', 'tell', 'ten',
  'tenant', 'tennis', 'tent', 'term', 'test', 'text', 'thank', 'that',
  'theme', 'then', 'theory', 'there', 'they', 'thing', 'this', 'thought',
  'three', 'thrive', 'throw', 'thumb', 'thunder', 'ticket', 'tide', 'tiger',
  'tilt', 'timber', 'time', 'tiny', 'tip', 'tired', 'tissue', 'title',
  'toast', 'tobacco', 'today', 'toddler', 'toe', 'together', 'toilet', 'token',
  'tomato', 'tomorrow', 'tone', 'tongue', 'tonight', 'tool', 'tooth', 'top',
  'topic', 'topple', 'torch', 'tornado', 'tortoise', 'toss', 'total', 'tourist',
  'toward', 'tower', 'town', 'toy', 'track', 'trade', 'traffic', 'tragic',
  'train', 'transfer', 'trap', 'trash', 'travel', 'tray', 'treat', 'tree',
  'trend', 'trial', 'tribe', 'trick', 'trigger', 'trim', 'trip', 'trophy',
  'trouble', 'truck', 'true', 'truly', 'trumpet', 'trust', 'truth', 'try',
  'tube', 'tuition', 'tumble', 'tuna', 'tunnel', 'turkey', 'turn', 'turtle',
  'twelve', 'twenty', 'twice', 'twin', 'twist', 'two', 'type', 'typical',
  'ugly', 'umbrella', 'unable', 'unaware', 'uncle', 'uncover', 'under', 'undo',
  'unfair', 'unfold', 'unhappy', 'uniform', 'unique', 'unit', 'universe', 'unknown',
  'unlock', 'until', 'unusual', 'unveil', 'update', 'upgrade', 'uphold', 'upon',
  'upper', 'upset', 'urban', 'urge', 'usage', 'use', 'used', 'useful',
  'useless', 'usual', 'utility', 'vacant', 'vacuum', 'vague', 'valid', 'valley',
  'valve', 'van', 'vanish', 'vapor', 'various', 'vast', 'vault', 'vehicle',
  'velvet', 'vendor', 'venture', 'venue', 'verb', 'verify', 'version', 'very',
  'vessel', 'veteran', 'viable', 'vibrant', 'vicious', 'victory', 'video', 'view',
  'village', 'vintage', 'violin', 'virtual', 'virus', 'visa', 'visit', 'visual',
  'vital', 'vivid', 'vocal', 'voice', 'void', 'volcano', 'volume', 'vote',
  'voyage', 'wage', 'wagon', 'wait', 'walk', 'wall', 'walnut', 'want',
  'warfare', 'warm', 'warrior', 'wash', 'wasp', 'waste', 'water', 'wave',
  'way', 'wealth', 'weapon', 'wear', 'weasel', 'weather', 'web', 'wedding',
  'weekend', 'weird', 'welcome', 'west', 'wet', 'whale', 'what', 'wheat',
  'wheel', 'when', 'where', 'whip', 'whisper', 'wide', 'width', 'wife',
  'wild', 'will', 'win', 'window', 'wine', 'wing', 'wink', 'winner',
  'winter', 'wire', 'wisdom', 'wise', 'wish', 'witness', 'wolf', 'woman',
  'wonder', 'wood', 'wool', 'word', 'work', 'world', 'worry', 'worth',
  'wrap', 'wreck', 'wrestle', 'wrist', 'write', 'wrong', 'yard', 'year',
  'yellow', 'you', 'young', 'youth', 'zebra', 'zero', 'zone', 'zoo',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proximity keywords (English + Romanian) — within ±50 chars triggers redact
 * in mode='input'. In mode='reply' these are ignored for proximity-based redact.
 *
 * Spec list (§8.2): 'private', 'seed', 'secret', 'cheia', 'mnemonic', 'parol',
 * 'parolă', 'password', 'pwd', 'wallet export', 'private key'.
 * Addition beyond spec: 'wallet' standalone — bare "wallet" near a hex/0x address
 * is high-signal suspicious context (operator-approved, Phone Claude review 2026-05-20).
 * NOTE: 'wallet' is PROXIMITY-ONLY — it triggers _hexMatchesNearProximity when a hex/0x
 * address is within ±50 chars. It is intentionally NOT included in the bare-keyword
 * fallback regex (mode='input', ~line 545) because 'wallet' alone is too ambiguous
 * (e.g., "my wallet address") without proximity context to a sensitive value.
 * See 'wallet export' below for the multi-word variant that qualifies separately.
 */
const PROXIMITY_KEYWORDS = [
    'private', 'seed', 'secret', 'cheia', 'mnemonic', 'parol', 'parolă',
    'password', 'pwd', 'wallet export',
    'wallet',  // proximity-only: triggers redact when near a hex/0x address (operator-approved
               // addition to spec's 'wallet export'). Intentionally NOT in bare-keyword fallback
               // regex (~line 545) — 'wallet' alone is too ambiguous (e.g., "my wallet address")
               // without proximity context to a sensitive value.
    'private key', 'jwt',
];

// Fact-key blacklist — case-insensitive substring match
const FACT_KEY_BLACKLIST = [
    'password', 'parol', 'pwd', 'key', 'cheia', 'secret', 'seed', 'mnemonic',
    'wallet', 'private', 'pin', 'otp', '2fa_code', 'api_key', 'jwt', 'token',
];

// Allowlist exception — keys starting with this prefix are not blacklisted
const FACT_KEY_ALLOWLIST_PREFIX = 'trading_token_preference';

// Closed-enum allowlists per class
const CLASS_KEY_ALLOWLISTS = {
    identity: new Set(['name', 'primary_language', 'comm_style', 'role']),
    style: new Set(['tone', 'format', 'emoji', 'length', 'depth', 'push_back', 'error_handling', 'jokes']),
    personal_context: new Set(['location', 'timezone', 'language', 'comm_style', 'profession', 'schedule', 'family_context', 'hobbies']),
    // trading_strategy and temporary are open vocab
};

// Redaction placeholder
const REDACTED = '[REDACTED]';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Luhn algorithm check — returns true if digits pass Luhn checksum.
 * @param {string} numStr — digits only (no spaces/dashes)
 */
function _luhnCheck(numStr) {
    const digits = numStr.replace(/\D/g, '');
    if (digits.length < 13) return false;
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alternate) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        sum += n;
        alternate = !alternate;
    }
    return sum % 10 === 0;
}

/**
 * Checks whether the given text contains 12+ consecutive BIP39 words
 * with NO non-BIP39 word intercalated between them.
 *
 * Strategy: tokenize to lower-case words, find maximal run of BIP39 words.
 * @param {string} text
 * @returns {boolean}
 */
function _bip39Sequence(text) {
    const tokens = text.toLowerCase().match(/[a-z]+/g);
    if (!tokens || tokens.length < 12) return false;
    let run = 0;
    let maxRun = 0;
    for (const tok of tokens) {
        if (BIP39_WORDS.has(tok)) {
            run++;
            if (run > maxRun) maxRun = run;
        } else {
            run = 0;
        }
    }
    return maxRun >= 12;
}

/**
 * Finds all hex regex matches that have a proximity keyword within ±50 chars.
 *
 * Per spec §8.2: Hex64 + proximity-keyword within ±50 chars → private keys.
 * Hex40 with 0x prefix + proximity-keyword within ±50 chars → wallet addresses.
 *
 * @param {string} text — original text (not lowercased)
 * @param {RegExp} regex — must use /g flag; will be cloned fresh each call
 * @param {string} type — redaction type label
 * @returns {Array<{start: number, end: number, type: string}>}
 */
function _hexMatchesNearProximity(text, regex, type) {
    const matches = [];
    const freshRe = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = freshRe.exec(text)) !== null) {
        const hexStart = m.index;
        const hexEnd = hexStart + m[0].length;

        // ±50 char window around the hex match boundaries
        const ctxStart = Math.max(0, hexStart - 50);
        const ctxEnd = Math.min(text.length, hexEnd + 50);
        const ctx = text.slice(ctxStart, ctxEnd).toLowerCase();

        if (PROXIMITY_KEYWORDS.some(kw => ctx.includes(kw.toLowerCase()))) {
            matches.push({ start: hexStart, end: hexEnd, type });
        }
    }
    return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regex definitions (all exact-match patterns — used in both modes)
// These are the "exact match" patterns that always redact in both modes.
// ─────────────────────────────────────────────────────────────────────────────

// JWT: 3-part base64url separated by dots — each part 20+ chars
// Must NOT match simple domain names (handled by min-length requirement)
const RE_JWT = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;

// 64-char lowercase hex (private key candidate) — exact length match
const RE_HEX64 = /\b[a-fA-F0-9]{64}\b/g;

// 0x prefixed 40-char hex (Ethereum address)
const RE_ETH_ADDR = /\b0x[a-fA-F0-9]{40}\b/g;

// Credit card: 13–19 digits with optional spaces/dashes, validated by Luhn
const RE_CC_CANDIDATE = /\b(?:\d[ -]*?){13,19}\b/g;

// password=value exact pattern (mode='reply' + mode='input'):
// requires [:=] separator (KEY=value or KEY: value) — not plain space
const RE_PWD_EXACT = /(password|parol[aă]?|pwd|secret)\s*[:=]\s*\S+/gi;

// password proximity pattern (mode='input' only):
// triggers even without a value — keyword alone, space-separated
const RE_PWD_LOOSE = /(password|parol[aă]?|pwd|secret)[ :=]+\S+/gi;

// Stripe key: sk_(live|test)_ followed by 20+ alphanumeric chars
const RE_STRIPE = /\bsk_(live|test)_[A-Za-z0-9]{20,}\b/g;

// ─────────────────────────────────────────────────────────────────────────────
// Core redact logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply redactions to text.
 *
 * @param {string} text
 * @param {{ mode?: 'input' | 'reply' }} opts
 * @returns {{ redactedText: string, redactionCount: number, redactionTypes: string[] }}
 */
function redact(text, opts = {}) {
    if (!text || typeof text !== 'string') {
        return { redactedText: text || '', redactionCount: 0, redactionTypes: [] };
    }

    const mode = opts.mode || 'input';
    let result = text;
    let redactionCount = 0;
    const redactionTypesSet = new Set();

    /**
     * Helper: replace regex matches, track count + types.
     * @param {RegExp} re — must be a fresh regex (g flag, NOT stateful)
     * @param {string} typeName
     * @param {Function|null} filter — optional: (match) => bool, only redact if true
     */
    const applyRegex = (re, typeName, filter = null) => {
        const freshRe = new RegExp(re.source, re.flags);
        const newResult = result.replace(freshRe, (match) => {
            if (filter && !filter(match)) return match;
            redactionCount++;
            redactionTypesSet.add(typeName);
            return REDACTED;
        });
        result = newResult;
    };

    // ── Exact-match patterns (same in both modes) ──────────────────────────

    // JWT — 3-part dot token (20+.20+.20+ base64url)
    // Must not match domain names: domain parts are short (e.g. example=7, com=3)
    // We require all 3 parts to be 20+ chars
    applyRegex(RE_JWT, 'jwt');

    // BIP39 seed phrase — 12+ consecutive words
    // BIP39 redact strategy (mode='input' high-recall):
    // Outer guard _bip39Sequence() detects 12+ consecutive BIP39 words.
    // Inner regex [a-zA-Z]+(?:\s+[a-zA-Z]+){11,} captures the surrounding alpha span
    // for replacement. The captured span MAY include adjacent non-BIP39 alphabetic
    // words if they happen to surround a BIP39 12-run. This over-redaction is
    // acceptable per spec §8.2 (mode='input' = high-recall: prefer redacting
    // surrounding context over leaking partial seed). The redacted span is then
    // re-validated via _bip39Sequence to confirm BIP39 presence — non-BIP39 spans
    // pass through unchanged.
    if (_bip39Sequence(result)) {
        // Find and replace the 12+ consecutive BIP39 word sequence
        // Strategy: walk tokens and replace the run
        result = result.replace(/([a-zA-Z]+(?:\s+[a-zA-Z]+){11,})/g, (match) => {
            if (_bip39Sequence(match)) {
                redactionCount++;
                redactionTypesSet.add('bip39_seed');
                return REDACTED;
            }
            return match;
        });
    }

    // password=value / KEY=VALUE pattern
    // mode='reply': exact [:=] separator required (no false-positives on bare keywords)
    // mode='input': loose pattern (space separator also triggers)
    if (mode === 'reply') {
        applyRegex(RE_PWD_EXACT, 'password_value');
    } else {
        applyRegex(RE_PWD_LOOSE, 'password_value');
    }

    // Stripe API key
    applyRegex(RE_STRIPE, 'stripe_key');

    // Credit card (Luhn-validated)
    applyRegex(RE_CC_CANDIDATE, 'credit_card', (match) => {
        const digits = match.replace(/\D/g, '');
        return digits.length >= 13 && digits.length <= 19 && _luhnCheck(digits);
    });

    // ── Proximity-based patterns ───────────────────────────────────────────
    //
    // mode='input': redact hex64/ETH only if a proximity keyword is within ±50 chars
    //   of the hex match (per spec §8.2). If keyword exists but no hex/addr matched,
    //   still redact the bare keyword as suspicious context.
    // mode='reply': redact ONLY on exact hex/address match (proximity not required).

    if (mode === 'input') {
        // Find hex64 matches that have a proximity keyword within ±50 chars
        const hex64Matches = _hexMatchesNearProximity(result, RE_HEX64, 'hex64_private');
        // Find ETH address matches that have a proximity keyword within ±50 chars
        const ethMatches = _hexMatchesNearProximity(result, RE_ETH_ADDR, 'eth_addr_private');

        const allHexMatches = [...hex64Matches, ...ethMatches]
            .sort((a, b) => b.start - a.start); // reverse order for safe splice

        let hexFound = hex64Matches.length > 0;
        let ethFound = ethMatches.length > 0;

        // Replace matches right-to-left to preserve indices
        for (const match of allHexMatches) {
            result = result.slice(0, match.start) + REDACTED + result.slice(match.end);
            redactionCount++;
            redactionTypesSet.add(match.type);
        }

        // Bare-keyword fallback (mode='input' high-recall only).
        // Spec §8.2: proximity-keyword presence alone is a high-recall signal —
        // fires regardless of whether unrelated hex exists elsewhere in text.
        // Guard is just !hexFound && !ethFound (i.e., no hex was within proximity).
        // If a keyword+hex IS in proximity, hexFound/ethFound are true and we
        // already redacted via the hex matcher — no double-firing.
        if (!hexFound && !ethFound) {
            // No hex was within proximity of any keyword — keyword alone is suspicious context
            const lowerResult = result.toLowerCase();
            const hasAnyKw = PROXIMITY_KEYWORDS.some(kw => lowerResult.includes(kw.toLowerCase()));
            if (hasAnyKw) {
                result = result.replace(
                    /(private\s+key|wallet\s+export|private|seed|secret|cheia|mnemonic|parol[aă]?|password|pwd|jwt)/gi,
                    (m) => {
                        redactionCount++;
                        redactionTypesSet.add('proximity_keyword');
                        return REDACTED;
                    }
                );
            }
        }
    } else {
        // mode='reply': exact match only for hex64 and eth addresses
        // Only redact if the hex64/ETH address is actually present (proximity ignored)
        applyRegex(RE_HEX64, 'hex64_private');
        applyRegex(RE_ETH_ADDR, 'eth_addr_private');
    }

    return {
        redactedText: result,
        redactionCount,
        redactionTypes: Array.from(redactionTypesSet),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a fact_key is blacklisted.
 * Case-insensitive substring match against FACT_KEY_BLACKLIST.
 * Exception: keys starting with FACT_KEY_ALLOWLIST_PREFIX are never blacklisted.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isFactKeyBlacklisted(key) {
    if (typeof key !== 'string') return false;
    const lower = key.toLowerCase();

    // Allowlist exception first
    if (lower.startsWith(FACT_KEY_ALLOWLIST_PREFIX)) return false;

    // Check blacklist
    for (const term of FACT_KEY_BLACKLIST) {
        if (lower.includes(term)) return true;
    }
    return false;
}

/**
 * Checks whether a fact key is allowed for the given class.
 * For closed-enum classes (identity/style/personal_context): enforces allowlist.
 * For open-vocab classes (trading_strategy/temporary): always true.
 *
 * @param {string} klass
 * @param {string} key
 * @returns {boolean}
 */
function isClassKeyAllowed(klass, key) {
    const allowlist = CLASS_KEY_ALLOWLISTS[klass];
    if (!allowlist) return true; // open vocab
    return allowlist.has(key);
}

/**
 * Validates a fact value — rejects values that contain secrets.
 * Runs Luhn check on numeric values, BIP39 check on textual values.
 *
 * @param {string} value
 * @param {string} klass
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateFactValue(value, klass) {
    if (typeof value !== 'string') return { ok: false, reason: 'not_string' };

    // BIP39 seed check
    if (_bip39Sequence(value)) {
        return { ok: false, reason: 'bip39_seed_detected' };
    }

    // Luhn credit card check
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && _luhnCheck(digitsOnly)) {
        return { ok: false, reason: 'credit_card_detected' };
    }

    // JWT check
    RE_JWT.lastIndex = 0;
    if (RE_JWT.test(value)) {
        return { ok: false, reason: 'jwt_detected' };
    }

    // Stripe key check
    RE_STRIPE.lastIndex = 0;
    if (RE_STRIPE.test(value)) {
        return { ok: false, reason: 'stripe_key_detected' };
    }

    return { ok: true };
}

/**
 * Classifies content for extractability — checks for blocked patterns.
 *
 * @param {string} text
 * @returns {{ hasContent: boolean, blockedClasses: string[] }}
 */
function classifyExtractableContent(text) {
    if (!text || typeof text !== 'string') {
        return { hasContent: false, blockedClasses: [] };
    }
    const { redactionCount, redactionTypes } = redact(text, { mode: 'input' });
    return {
        hasContent: text.trim().length > 0,
        blockedClasses: redactionTypes,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    redactPipeline: {
        redact,
        classifyExtractableContent,
        isFactKeyBlacklisted,
        validateFactValue,
        isClassKeyAllowed,
    },
    _internals: {
        _luhnCheck,
        _bip39Sequence,
    },
};
