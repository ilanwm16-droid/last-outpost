// Campaign «30 ночей до рассвета»: a hand-designed table of 30 waves split into
// six acts, plus a deterministic generator for endless mode (waves 31+).
// Pure data module: no DOM, no three.js, safe to import from Node tests.
//
// Wave definition shape (see spec section 1):
// {wave, act, title, briefing:[{who:'Маяк'|'Кряк FM', text}], hint?, mix:{walker,
//  runner, brute, exploder, crawler, spitter, screamer, armored}, countScale,
//  event:'blood'|'fog'|'gold'|'swarm'|'scarce'|null, weather:'clear'|'rain'|'fog'|'storm',
//  boss:[types]|null, unlock:'smg'|'svd'|null, tod:0..1}
// `mix` holds relative weights (normalized by rules.waveConfig). Boss type ids:
// 'boss' (Titan, legacy id), 'brood', 'butcher', 'father'.

export const CAMPAIGN_LENGTH = 30;
export const MAYAK = 'Маяк';
export const DUCK = 'Кряк FM';

export const ACTS = [
  { n: 1, roman: 'I', title: 'Первая ночь', from: 1, to: 5, label: 'АКТ I · ПЕРВАЯ НОЧЬ', summary: 'Пост на трассе выходит на связь. Мертвецы учатся бегать.' },
  { n: 2, roman: 'II', title: 'Голос в эфире', from: 6, to: 10, label: 'АКТ II · ГОЛОС В ЭФИРЕ', summary: 'Из центра города звучит запись, и вся орда идёт на неё.' },
  { n: 3, roman: 'III', title: 'Туман', from: 11, to: 15, label: 'АКТ III · ТУМАН', summary: 'С химзавода ползёт туман. В нём кто-то кричит и охотится.' },
  { n: 4, roman: 'IV', title: 'Кровавая луна', from: 16, to: 20, label: 'АКТ IV · КРОВАВАЯ ЛУНА', summary: 'Красная луна бесит толпу. Вертолёт задерживается.' },
  { n: 5, roman: 'V', title: 'Последний патрон', from: 21, to: 25, label: 'АКТ V · ПОСЛЕДНИЙ ПАТРОН', summary: 'Шторм прижал дроны снабжения. Каждый патрон на счету.' },
  { n: 6, roman: 'VI', title: 'Рассвет', from: 26, to: 30, label: 'АКТ VI · РАССВЕТ', summary: 'Небо светлеет. Отец Орды выходит из города.' },
];
// Pseudo-act for waves 31+.
export const ENDLESS_ACT = { n: 7, roman: '∞', title: 'Бесконечная ночь', from: 31, to: Infinity, label: 'БЕСКОНЕЧНАЯ НОЧЬ', summary: 'Вертолёт улетел. Кто-то должен держать трассу.' };

export const UNLOCKS = { smg: 7, svd: 12 };
export const BOSS_NAMES = { boss: 'Титан', titan: 'Титан', brood: 'Матка', butcher: 'Мясник', father: 'Отец Орды' };

export const INTRO = {
  title: '30 ночей до рассвета',
  lines: [
    { who: null, text: 'Сектор 07. Город умер за одну ночь — и с тех пор эта ночь не кончается.' },
    { who: null, text: 'Вы — последний пост на трассе: мешки с песком, прожектор, ящик патронов и рация.' },
    { who: MAYAK, text: 'Рубеж-7, вертолёт придёт на рассвете. До рассвета — тридцать волн. Каждая — как целая ночь.' },
  ],
};

export const VICTORY = {
  title: 'РАССВЕТ',
  subtitle: 'Рубеж-7 выстоял',
  lines: [
    { who: null, text: 'Отец Орды рухнул — и вся орда легла вместе с ним, будто кто-то выдернул вилку из розетки.' },
    { who: null, text: 'Над трассой встаёт солнце. Вертушка садится прямо на перекрёстке у КПП.' },
    { who: MAYAK, text: 'Рубеж-7, вы продержались. Тридцать волн. Поднимайтесь на борт — летим домой.' },
    { who: DUCK, text: 'Это был Кряк FM, единственная станция, пережившая конец света. Не переключайтесь!' },
  ],
};
VICTORY.text = VICTORY.lines.map(l => (l.who ? l.who + ': ' : '') + l.text).join('\n');

export const ENDLESS_INTRO = {
  title: 'Бесконечная ночь',
  lines: [
    { who: MAYAK, text: 'Рубеж-7, на борту есть места, но трассу держать некому. Вы остаётесь? Принято. Удачи.' },
    { who: DUCK, text: 'Кряк FM тоже остаётся. Кто-то же должен ставить музыку в конце света.' },
  ],
};

const M = (who, text) => ({ who: who === 'm' ? MAYAK : DUCK, text });
// Mix shorthand: w=walker r=runner b=brute x=exploder c=crawler s=spitter k=screamer a=armored.
const mix = (w = 0, r = 0, b = 0, x = 0, c = 0, s = 0, k = 0, a = 0) =>
  ({ walker: w, runner: r, brute: b, exploder: x, crawler: c, spitter: s, screamer: k, armored: a });

const WAVES = [
  // ── Act I «Первая ночь»: tutorial, one new enemy or mechanic per wave.
  { wave: 1, title: 'Контакт', tod: 0, weather: 'clear', event: null, countScale: 1, mix: mix(1),
    briefing: [M('m', 'Рубеж-7, говорит Маяк. Вы — последний пост на трассе у Сектора 07. Эвакуация на рассвете. Держитесь.'),
      M('d', 'Кряк FM в эфире! Единственная станция, пережившая конец света. Музыка до рассвета — или пока не сядут батарейки!')],
    hint: 'WASD — движение, ЛКМ — огонь, ПКМ — прицел. Попадание в голову убивает быстрее.' },
  { wave: 2, title: 'Бегущие', tod: .02, weather: 'clear', event: null, countScale: 1, mix: mix(.84, .16),
    briefing: [M('m', 'Фиксирую быстрые цели. Свежие — ещё не разучились бегать. Не дайте им зайти с флангов.'),
      M('d', 'Бегуны! Как утренняя пробежка, только завтрак — это вы.')],
    hint: 'Shift — бег, R — перезарядка. Перезаряжайся за спинами баррикад, а не в толпе.' },
  { wave: 3, title: 'Раздутые', tod: .04, weather: 'clear', event: null, countScale: 1, mix: mix(.72, .17, 0, .11),
    briefing: [M('m', 'Внимание: раздутые особи. Вблизи детонируют. Бейте издалека и не подпускайте к напарнику.'),
      M('d', 'Если зомби светится и пищит — это не подарок. Хотя... нет, всё-таки не подарок.')],
    hint: 'G — граната. Дождись, пока толпа соберётся в кучу, и брось в середину.' },
  { wave: 4, title: 'Тяжёлый шаг', tod: .06, weather: 'rain', event: null, countScale: 1, mix: mix(.6, .18, .12, .1),
    briefing: [M('m', 'С запада идут крупные. Громила держит полмагазина. Сосредоточьте огонь и не стойте у него на пути.'),
      M('d', 'Есть идея: жмите Q — и я поставлю хит. Мертвецы не устоят. В смысле, будут танцевать на месте.')],
    hint: 'Q — утка-диджей: зомби возле колонки танцуют и не нападают. Потом нужна перезарядка.' },
  { wave: 5, title: 'Титан', tod: .08, weather: 'clear', event: null, countScale: .8, mix: mix(.58, .2, .12, .1), boss: ['boss'],
    briefing: [M('m', 'Сейсмодатчики сходят с ума. По трассе идёт что-то очень большое. Сбрасываю вам миниган.'),
      M('d', 'Это не землетрясение, это Титан. Совет редакции: голова светится — туда и стреляйте.')],
    hint: 'Между волнами выбирай усиление клавишами 1–3. Миниган падает в центр поста — подбери его.' },

  // ── Act II «Голос в эфире»: spitters, crawlers, the looped broadcast that draws the horde.
  { wave: 6, title: 'Помехи', tod: .1, weather: 'clear', event: null, countScale: 1, mix: mix(.5, .2, .1, .08, 0, .12),
    briefing: [M('m', 'Рубеж-7, вертолётная база не выходит на связь. Разбираемся. А у вас гости: плюются кислотой издалека.'),
      M('d', 'Плевуны, народ! Не стойте в зелёных лужах. Это не лимонад. Я проверял. Не спрашивайте.')],
    hint: 'Плевуны держат дистанцию — выбивай их первыми. Кислотная лужа жжёт: не стой в ней.' },
  { wave: 7, title: 'Бизон', tod: .12, weather: 'rain', event: null, countScale: 1.02, mix: mix(.42, .18, .1, .07, .13, .1), unlock: 'smg',
    briefing: [M('m', 'У КПП оставили ящик: ПП «Бизон», шестьдесят четыре патрона в магазине. Забирайте.'),
      M('m', 'И смотрите под ноги. Ползуны ходят стаями и прячутся в траве у отбойника.'),
      M('d', 'Ползуны — это зомби, которые сдались, но не до конца. Уважаю.')],
    hint: '3 — ПП «Бизон», колесо мыши листает оружие. Ползуны низкие: целься ниже.' },
  { wave: 8, title: 'Голос', tod: .14, weather: 'clear', event: 'swarm', countScale: .95, mix: mix(.4, .25, .1, .07, .1, .08),
    briefing: [M('m', 'Перехватили передачу из центра: «Кто-нибудь, ответьте». Женский голос. Повторяется каждые четыре минуты.'),
      M('m', 'Это запись. И мертвецы идут на неё, как мотыльки. Вот откуда такие толпы.'),
      M('d', 'Конкуренты в эфире? Ну уж нет. Кряк FM перекричит любую трансляцию!')] },
  { wave: 9, title: 'Глушилка', tod: .16, weather: 'rain', event: null, countScale: 1.05, mix: mix(.38, .2, .12, .08, .12, .1),
    briefing: [M('d', 'Я подкрутил передатчик! Теперь из центра слышно только моё кряканье. Мертвецы в ярости.'),
      M('m', 'Утка дело говорит: сигнал сбит. Но всё, что шло на голос, теперь идёт на вас.')] },
  { wave: 10, title: 'Матка', tod: .18, weather: 'rain', event: null, countScale: .8, mix: mix(.42, .2, .1, .08, .1, .1), boss: ['brood'],
    briefing: [M('m', 'Тепловизор видит гнездо под эстакадой. Огромная особь рожает ползунов. Это Матка. Уничтожить.'),
      M('d', 'Светящиеся мешки на её спине — слабое место. Не благодарите. Ладно, благодарите.')],
    hint: 'Мешки Матки считаются попаданием в голову. Не дай ползунам окружить тебя.' },

  // ── Act III «Туман»: chemical fog and rain, screamers, the sniper rifle, the Butcher.
  { wave: 11, title: 'Белая стена', tod: .2, weather: 'fog', event: null, countScale: 1, mix: mix(.34, .18, .12, .08, .12, .1, .06),
    briefing: [M('m', 'С химзавода ползёт туман, видимость двадцать метров. И что-то кричит — после крика толпа ускоряется.'),
      M('d', 'Крикуны! Такой вокал даже я бы в эфир не пустил. Заткните их первыми.')],
    hint: 'Крикун ускоряет зомби вокруг себя. Бей его, пока он раскрывает пасть.' },
  { wave: 12, title: 'Дальний выстрел', tod: .22, weather: 'rain', event: null, countScale: 1.02, mix: mix(.32, .18, .12, .08, .12, .1, .08), unlock: 'svd',
    briefing: [M('m', 'На вышке нашли СВД с оптикой. Десять патронов, пробивает троих навылет. Крикуны — ваши.'),
      M('d', 'Снайперка! Наконец-то можно держать зомби на расстоянии вытянутой пули.')],
    hint: '4 — СВД. Без прицела она косит: ПКМ — оптика, один клик — один выстрел.' },
  { wave: 13, title: 'Слепые', tod: .24, weather: 'fog', event: 'fog', countScale: .98, mix: mix(.36, .14, .12, .1, .14, .08, .06),
    briefing: [M('m', 'Дроны ослепли, туман густеет. Работайте по звуку: шаги, хрип — стреляйте на шум.'),
      M('d', 'Говорят, в тумане зомби нас не видят. Говорят, это неправда. Кто говорит? Я и говорю.')] },
  { wave: 14, title: 'Пропавший патруль', tod: .26, weather: 'rain', event: 'gold', countScale: 1.04, mix: mix(.3, .2, .12, .08, .12, .1, .08),
    briefing: [M('m', 'Нашли патруль «Сокол», пропавший три дня назад. Живых нет. Их снаряжение — на зомби. Собирайте всё.'),
      M('d', 'Мародёрство в прямом эфире! Мама бы не одобрила. Мама — утка, ей всё равно.')] },
  { wave: 15, title: 'Мясник', tod: .28, weather: 'storm', event: null, countScale: .8, mix: mix(.34, .2, .1, .08, .12, .1, .06), boss: ['butcher'],
    briefing: [M('m', 'Патруль утащило что-то с крюком. Оно приходит за отставшими. Держитесь вместе. Мясник идёт.'),
      M('d', 'Слышите звон цепи — уходите с линии броска. Поймал крюк — стреляй, пока тащит.')],
    hint: 'Мясник бросает крюк на 6–20 метров и тянет к себе. Держись за укрытиями.' },

  // ── Act IV «Кровавая луна»: armored riot zombies, frenzied blood-moon waves, the evac slips.
  { wave: 16, title: 'Красное небо', tod: .3, weather: 'clear', event: 'blood', countScale: .97, mix: mix(.28, .16, .1, .07, .1, .09, .06, .14),
    briefing: [M('m', 'Луна покраснела от дыма пожаров, толпа взбесилась. И на трассе ОМОН. Бывший. Со щитами.'),
      M('d', 'Щит спереди — значит, заходим сбоку. Или в голову. Или сбоку в голову, если вы талантливы.')],
    hint: 'Штурмовик держит щит: стреляй в голову, в спину или с фланга.' },
  { wave: 17, title: 'Задержка', tod: .32, weather: 'rain', event: null, countScale: 1.02, mix: mix(.26, .17, .11, .08, .1, .1, .07, .11),
    briefing: [M('m', 'Плохие новости: вертолёту не хватает топлива, ищут. Рассвет в силе. Вертушка — под вопросом.'),
      M('m', 'Отставить панику. Я вас не брошу. Держите трассу.'),
      M('d', 'А я пока поставлю что-нибудь бодрое. Под апокалипсис отлично идёт диско.')] },
  { wave: 18, title: 'Бешенство', tod: .34, weather: 'clear', event: 'blood', countScale: 1, mix: mix(.24, .2, .1, .08, .1, .1, .06, .12),
    briefing: [M('m', 'Под красной луной они быстрее и злее. Не геройствуйте, держите дистанцию, прикрывайте друг друга.'),
      M('d', 'Двойные очки за каждого! Ведущий не несёт ответственности за ваши нервы.')] },
  { wave: 19, title: 'Прорыв', tod: .36, weather: 'clear', event: 'blood', countScale: 1.03, mix: mix(.22, .18, .12, .08, .11, .1, .07, .12),
    briefing: [M('m', 'Северный пост пал. Вы — последний рубеж на трассе. Всё, что шло на них, идёт к вам.'),
      M('d', '«Последний рубеж» — так будет называться мой следующий альбом. Доживите до презентации.')] },
  { wave: 20, title: 'Близнецы', tod: .38, weather: 'storm', event: null, countScale: .78, mix: mix(.28, .18, .1, .08, .1, .1, .06, .1), boss: ['boss', 'boss'],
    briefing: [M('m', 'Два сейсмических следа с двух сторон. Два Титана. Миниган на подходе. Не дайте им сойтись.'),
      M('d', 'Титанов двое, нас — сколько есть. Считаю до трёх: два... Стреляйте!')] },

  // ── Act V «Последний патрон»: storms, supply scarcity, everything mixed.
  { wave: 21, title: 'Пустые ящики', tod: .4, weather: 'storm', event: 'scarce', countScale: .97, mix: mix(.22, .17, .11, .08, .11, .11, .08, .12),
    briefing: [M('m', 'Шторм. Дроны снабжения на земле, сброса не будет. Каждый патрон на счету.'),
      M('d', 'Экономим патроны! Стреляем только в тех, кто очень хочет вас съесть. То есть во всех.')] },
  { wave: 22, title: 'Свежее мясо', tod: .42, weather: 'rain', event: 'swarm', countScale: .86, mix: mix(.22, .22, .1, .08, .1, .1, .07, .11),
    briefing: [M('m', 'Город выплёвывает новые толпы. Свежие, быстрые. Похоже, весь центр снялся с места.'),
      M('d', 'Бегунов столько, что я решил бросить курить. Я утка, я не курю. Вот настолько страшно.')] },
  { wave: 23, title: 'Шёпот', tod: .44, weather: 'storm', event: 'scarce', countScale: 1, mix: mix(.2, .18, .12, .08, .11, .11, .08, .12),
    briefing: [M('m', 'Запись из центра снова в эфире. Кряк, глуши. Рубеж-7, на голос идёт всё, что осталось.'),
      M('d', 'Глушу! Но она громче меня. Это уже личное.')] },
  { wave: 24, title: 'Тайник', tod: .47, weather: 'rain', event: 'gold', countScale: 1.02, mix: mix(.2, .18, .12, .08, .11, .11, .08, .12),
    briefing: [M('m', 'В фуре у отбойника — армейский склад. Это последний запас на трассе. Выбивайте всё, что рядом, и берите.'),
      M('d', 'Подарки посреди ночи! Дед Мороз, конечно, тоже зомби, но склад — настоящий.')] },
  { wave: 25, title: 'Семейный подряд', tod: .5, weather: 'storm', event: null, countScale: .78, mix: mix(.24, .18, .1, .08, .12, .1, .06, .12), boss: ['brood', 'butcher'],
    briefing: [M('m', 'Матка и Мясник. Вместе. Она плодит, он охотится. Начните с Матки, иначе утонете в ползунах.'),
      M('d', 'Ненавижу семейный бизнес. Особенно когда это бизнес по разделке.')],
    hint: 'Два босса сразу: держитесь вместе и бейте одну цель.' },

  // ── Act VI «Рассвет»: the sky brightens, maximum pressure, the Father of the Horde.
  { wave: 26, title: 'Серое небо', tod: .6, weather: 'fog', event: null, countScale: 1, mix: mix(.2, .18, .12, .08, .11, .11, .08, .12),
    briefing: [M('m', 'Небо светлеет. Топливо нашли — вертолёт вылетает. Ещё немного, Рубеж-7.'),
      M('d', 'Чувствуете? Это запах рассвета. И гари. Но в основном рассвета.')] },
  { wave: 27, title: 'Последний натиск', tod: .7, weather: 'clear', event: 'swarm', countScale: .84, mix: mix(.18, .22, .12, .08, .1, .1, .08, .12),
    briefing: [M('m', 'Свет их злит. Толпа ломится, пока солнце не встало. Это их последняя попытка — и самая сильная.'),
      M('d', 'Финальный хит-парад! Все треки — хиты, все зомби — ваши.')] },
  { wave: 28, title: 'Посылка', tod: .79, weather: 'rain', event: 'gold', countScale: 1.06, mix: mix(.18, .18, .13, .08, .11, .11, .09, .12),
    briefing: [M('m', 'Вертушка сбросила груз по пути: патроны и аптечки. Пилот передаёт: «Держитесь, мы близко».'),
      M('d', 'Пилот, если слышишь — привези кукурузы. Для утки. Это важно для морали.')] },
  { wave: 29, title: 'Земля дрожит', tod: .88, weather: 'clear', event: null, countScale: 1.12, mix: mix(.16, .18, .13, .08, .11, .11, .1, .13),
    briefing: [M('m', 'Из центра идёт что-то, перед чем расступается вся орда. Это оно звало их всю ночь. Отец Орды.'),
      M('d', 'Двадцать лет в эфире, а впервые не знаю, какую песню поставить.')] },
  { wave: 30, title: 'Рассвет', tod: 1, weather: 'clear', event: null, countScale: .72, mix: mix(.2, .18, .12, .08, .12, .1, .08, .12), boss: ['father'],
    briefing: [M('m', 'Рубеж-7, вертолёт в пяти минутах. Отец Орды на трассе. Убейте его — и мы забираем вас домой.'),
      M('d', 'Это была лучшая ночь в истории Кряк FM. Давайте закончим её красиво.'),
      M('m', 'Солнце встаёт. Огонь!')],
    hint: 'Отец Орды меняет тактику на 2/3 и 1/3 здоровья. Его смерть убьёт всю орду.' },
];

for (const w of WAVES) {
  w.act = actFor(w.wave).n;
  if (!('hint' in w)) w.hint = null;
  if (!('boss' in w)) w.boss = null;
  if (!('unlock' in w)) w.unlock = null;
  Object.freeze(w);
}
export const CAMPAIGN = Object.freeze(WAVES);

export function actFor(n) {
  const w = Math.max(1, Math.floor(Number(n) || 1));
  return ACTS.find(a => w >= a.from && w <= a.to) || ENDLESS_ACT;
}

export function isBossWave(n) { const d = getWave(n); return !!(d.boss && d.boss.length); }
export function isEndless(n) { return Math.floor(Number(n) || 1) > CAMPAIGN_LENGTH; }
export function bossName(type) { return BOSS_NAMES[type] || 'Босс'; }
// Repeated bosses are grouped with Russian counted forms: ['boss','boss','brood'] →
// ['два Титана', 'Матка'], ['brood','brood'] → ['две Матки'].
const BOSS_COUNTED = { boss: 'Титана', titan: 'Титана', brood: 'Матки', butcher: 'Мясника', father: 'Отца Орды' };
const BOSS_FEMININE = new Set(['brood']);
const NUM = { 2: ['два', 'две'], 3: ['три', 'три'], 4: ['четыре', 'четыре'] };
export function bossGroups(list) {
  const counts = new Map();
  for (const t of Array.isArray(list) ? list : []) { const k = t === 'titan' ? 'boss' : t; counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts].map(([t, n]) => n === 1 ? bossName(t) : `${(NUM[n] || [String(n), String(n)])[BOSS_FEMININE.has(t) ? 1 : 0]} ${BOSS_COUNTED[t] || bossName(t)}`);
}
// Display title of a boss line-up: 'Два Титана + Матка'.
export function bossTitle(list) { const s = bossGroups(list).join(' + '); return s.charAt(0).toUpperCase() + s.slice(1); }
// Weapons available at the start of wave n ('smg' from 7, 'svd' from 12).
export function unlockedWeapons(n) {
  const w = Math.floor(Number(n) || 1);
  return Object.keys(UNLOCKS).filter(k => w >= UNLOCKS[k]);
}

// Returns the wave definition for any wave number. Waves 1..30 come from the
// table above; 31+ are generated deterministically from the wave number, so the
// host and every client derive the same definition without extra packets.
export function getWave(n) {
  const w = Math.max(1, Math.min(9999, Math.floor(Number(n) || 1)));
  return w <= CAMPAIGN_LENGTH ? WAVES[w - 1] : endlessWave(w);
}

// ── Endless mode ──────────────────────────────────────────────────────────
// Deterministic PRNG (mulberry32) seeded by the wave number.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
// Boss rotation for waves 35, 40, 45...; every 30th wave brings the Father back.
const ENDLESS_BOSSES = [['boss', 'brood'], ['butcher', 'butcher'], ['brood', 'brood'], ['boss', 'butcher'], ['boss', 'boss', 'brood']];
const ENDLESS_TITLES = ['Ещё одна ночь', 'Без сна', 'Глухая трасса', 'Пепел', 'Чёрный эфир', 'Старые раны', 'Тишина перед бурей', 'Голодные', 'Холодный ветер', 'Обратный отсчёт'];
const ENDLESS_MAYAK = [
  'Рубеж-7, новая волна с востока. Вы знаете, что делать.',
  'Тепловизор снова красный от края до края. Держите трассу.',
  'Снабжение сброшу, как только стихнет ветер. Пока — своими силами.',
  'Город не кончается. Мы тоже. Огонь по готовности.',
  'Фиксирую смешанную толпу: всё, что видели за ночь, и немного сверху.',
];
const ENDLESS_DUCK = [
  'Кряк FM продолжает вещание! Рекорд эфира побит, ведущий не спал ни минуты.',
  'По заявкам слушателей — снова хиты апокалипсиса. Слушатели, правда, мёртвые.',
  'Если вы это слышите, вы ещё живы. Поздравляю, это редкость.',
  'Ставлю вашу любимую. Ну, мою любимую. Вы привыкнете.',
];
const ENDLESS_EVENTS = ['blood', 'fog', 'gold', 'swarm', 'scarce'];
const ENDLESS_WEATHER = ['clear', 'clear', 'rain', 'fog', 'storm'];

function endlessWave(w) {
  const r = rng(w * 2654435761);
  const k = w - CAMPAIGN_LENGTH;
  const bossWave = w % 5 === 0;
  const boss = bossWave ? (w % 30 === 0 ? ['father'] : ENDLESS_BOSSES[(w / 5 - 7) % ENDLESS_BOSSES.length]) : null;
  // Non-boss waves get an event about 45% of the time (mirrors rules.rollWaveEvent).
  const event = !bossWave && r() < .45 ? pick(ENDLESS_EVENTS, r) : null;
  // Every type present; weights wander a little around the act VI mix.
  const jitter = () => .85 + r() * .3;
  const m = mix(.18 * jitter(), .18 * jitter(), .13 * jitter(), .08 * jitter(), .11 * jitter(), .11 * jitter(), .09 * jitter(), .12 * jitter());
  const briefing = [M('m', pick(ENDLESS_MAYAK, r))];
  if (r() < .6) briefing.push(M('d', pick(ENDLESS_DUCK, r)));
  if (boss) briefing.unshift(M('m', 'На трассе ' + bossGroups(boss).join(' и ') + '. Миниган уже летит.'));
  return Object.freeze({
    wave: w, act: ENDLESS_ACT.n, title: boss ? bossTitle(boss) : pick(ENDLESS_TITLES, r),
    briefing: briefing.slice(0, 3), hint: null, mix: m,
    countScale: bossWave ? .8 : .95 + r() * .1,
    event, weather: pick(ENDLESS_WEATHER, r), boss, unlock: null,
    // A new night: darkness slowly cycles between deep night and pre-dawn.
    tod: +(.05 + .2 * (.5 - .5 * Math.cos(k / 10 * Math.PI * 2))).toFixed(3),
    endless: true,
  });
}
