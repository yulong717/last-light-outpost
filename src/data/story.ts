import type { CompanionRole } from './companions';
import type { ExploreEvent, Loot } from './explore';
import type { HeroId } from './heroes';

/**
 * 主線進程：開局只有主角一人，靠白天探索一章一章找到夥伴、槍械與新區域。
 * 每一章指定一個區域，走到該區最後一站時，大獎換成這章的劇情事件；
 * 事件成功後平安回到據點，這章就算完成：拿到固定獎勵、開放新區域、軍械庫進新貨。
 * 流程與數值說明見 docs/PROGRESSION.md。
 */

/** 劇情救到的具名倖存者 */
export interface NamedSurvivor {
  role: CompanionRole;
  name: string;
}

export interface ChapterReward extends Loot {
  named?: NamedSurvivor[];
}

export interface Chapter {
  id: string;
  /** 章名 */
  title: string;
  /** 最早第幾天才會觸發（控制節奏：一天最多推進一章） */
  minDay: number;
  /** 劇情發生的區域 */
  zone: string;
  /** 章節開場（這章開始的那天白天跳出） */
  intro: string[];
  /** 上方目標列的一句話 */
  objective: string;
  /** 取代該區大獎的劇情事件；選項成功的結果要標 story: true */
  finale: ExploreEvent;
  /** 劇情事件成功時給的固定獎勵（會顯示在結算畫面） */
  reward: ChapterReward;
  /** 回到據點後的收尾 */
  outro: string[];
  /** 完成後開放的區域 */
  openZones: string[];
  /** 完成後軍械庫可以用廢料買的武器 */
  shop: string[];
}

/** 新遊戲一開始就能去的區域 */
/** 新遊戲軍械庫就有賣的武器（主角身上的不用列） */
export const START_SHOP: string[] = ['bat'];
/** 第一章完成後一起開放的區域（三位主角共用） */
const AFTER_OPENING = ['gas', 'homes', 'market', 'school', 'downtown', 'nightmarket'];

/** 各主角的序章 */
export const PROLOGUES: Record<HeroId, { title: string; lines: string[] }> = {
  student: {
    title: '阿凱　放學後',
    lines: [
      '那天下午的練習賽打到一半，操場就被灰霧吞掉了。',
      '教練、隊友……你不敢回頭看。',
      '你抓著球棒躲進器材室，直到外面安靜下來。',
      '現在你得殺出學校，找個能過夜的地方。',
    ],
  },
  soldier: {
    title: '馬克　爆發點',
    lines: [
      '霧爆發那天，你的小隊正在鬧區十字路口拉封鎖線。',
      '十分鐘後，無線電裡只剩你一個人的呼吸聲。',
      '一把 M4A1、一把配槍，還有三個彈匣。',
      '城郊有座廢棄據點，先撐過今晚再說。',
    ],
  },
  lucky: {
    title: '好運姐　頭獎',
    lines: [
      '你在夜市口賣了二十年彩券，自己從來沒槓龜過。',
      '霧湧進夜市那晚，整條街只有你走出來。',
      '口袋裡是亡夫留下的 .357 左輪，還有一張沒刮的刮刮樂。',
      '「運氣好不代表能一直好。」你對自己說。',
    ],
  },
};

export const EPILOGUE = {
  title: '殘光不滅',
  lines: [
    '檢查站的軍用無線電還能用。你們對著雜訊喊了一整晚。',
    '沒有人回應。但據點的燈還亮著，身邊也不再只有你一個。',
    '從今天起，就是比誰撐得久了。',
    '（主線完成：所有區域與武器都已開放，夜晚會一天比一天凶。）',
  ],
};

/** 第一章：每位主角在自己的開局地點 */
export const OPENINGS: Record<HeroId, Chapter> = {
  student: {
    id: 'open-school',
    title: '第一章　殺出校園',
    minDay: 1,
    zone: 'school',
    intro: ['你在據點裡清點身上的東西：一根球棒，沒有別的了。', '保健室還有藥，體育館的後門通往外面。', '回學校一趟，把能用的都帶出來。'],
    objective: '回市立高中的保健室搬藥',
    finale: {
      id: 'story-gym',
      title: '體育館',
      text: '保健室就在體育館另一頭。籃球場上擠著一群穿制服的霧屍，有幾隻你認得。',
      weight: 0,
      options: [
        {
          label: '衝過球場',
          hint: '條件戰鬥：撐 20 秒（試試衝刺打）',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'survive', title: '撐 20 秒，衝到保健室', zombies: 4, seconds: 20 },
            success: { text: '你撞開保健室的門，把整個藥櫃掃進背包。', story: true, noise: 10 },
          },
        },
        {
          label: '沿著看台溜過去',
          hint: '潛入：走到最右邊',
          action: {
            type: 'field',
            field: { mode: 'stealth', goal: 'reach', title: '沿著看台溜到保健室', zombies: 4 },
            clean: { text: '沒有人發現你。保健室的藥、繃帶，還有校護藏在抽屜的零錢。', story: true, bonus: { scrap: 10 } },
            success: { text: '被發現了，但你還是搶到了藥櫃裡的東西。', story: true },
          },
        },
      ],
    },
    reward: { supplies: { medkit: 2, decoy: 1 }, scrap: 25 },
    outro: ['回到據點，你把藥排在桌上。', '收音機突然傳來敲擊聲：住宅區那邊，好像有人在用手電筒打信號。'],
    openZones: AFTER_OPENING,
    shop: ['machete'],
  },
  soldier: {
    title: '第一章　回到爆發點',
    id: 'open-downtown',
    minDay: 1,
    zone: 'downtown',
    intro: ['你的隊友倒在鬧區十字路口，他們身上還有彈藥和無線電。', '回去拿。不管看到什麼，都別停下來。'],
    objective: '回鬧區爆發點取回小隊的裝備',
    finale: {
      id: 'story-convoy',
      title: '翻覆的軍車',
      text: '小隊的軍車翻在路口中央，車門被扯開。幾隻穿著迷彩的霧屍在車旁搖晃，其中一隻戴著你熟悉的臂章。',
      weight: 0,
      options: [
        {
          label: '逐一擊倒',
          hint: '條件戰鬥：禁止開槍（用戰術擊倒）',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'clear', title: '不開槍，安靜解決軍車旁的霧屍', zombies: 4, meleeOnly: true },
            success: { text: '你替他們闔上眼睛，取下彈藥袋和無線電。', story: true },
          },
        },
        {
          label: '火力壓制',
          hint: '條件戰鬥：消滅全部・噪音 +30',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'clear', title: '清空十字路口', zombies: 6 },
            success: { text: '槍聲在大樓間迴盪。你搶回彈藥袋，在更多霧屍趕到前撤離。', story: true, noise: 30 },
          },
        },
      ],
    },
    reward: { ammo: { '556': 60 }, supplies: { grenade: 1 }, scrap: 15 },
    outro: ['無線電的電池只剩一格。', '在一片雜訊裡，你聽到住宅區方向傳來的求救：三短、三長、三短。'],
    openZones: AFTER_OPENING,
    shop: ['machete'],
  },
  lucky: {
    id: 'open-market',
    title: '第一章　頭獎',
    minDay: 1,
    zone: 'nightmarket',
    intro: ['彩券行的保險箱裡有你這些年存下的東西。', '還有那張沒刮的刮刮樂。', '夜市現在是霧屍的地盤，但你一向運氣很好。'],
    objective: '回夜市彩券行打開保險箱',
    finale: {
      id: 'story-safe',
      title: '彩券行保險箱',
      text: '鐵捲門半開，霓虹燈一閃一閃。保險箱就在櫃台後面，旁邊趴著一隻正在啃東西的霧屍。',
      weight: 0,
      options: [
        {
          label: '轉開保險箱',
          hint: 'QTE 方向鍵序列（密碼是你的生日）',
          action: {
            type: 'qte',
            qte: { kind: 'sequence', prompt: '照順序轉密碼盤！', count: 5, time: 3.6 },
            success: { text: '保險箱開了：一疊現金、一盒 .357 子彈，還有那張刮刮樂。你刮開它……又中了。', story: true },
            fail: { text: '密碼盤卡住，喀啦聲吵醒了那隻霧屍。你只好先跑。', noise: 30 },
          },
        },
        {
          label: '先解決那隻',
          hint: '條件戰鬥：消滅全部',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'clear', title: '清掉彩券行裡的霧屍', zombies: 4 },
            success: { text: '你慢慢轉開保險箱。現金、子彈，還有那張刮刮樂。……又中了。', story: true, noise: 10 },
          },
        },
      ],
    },
    reward: { ammo: { '357': 24 }, supplies: { lockpick: 1 }, scrap: 40 },
    outro: ['頭獎兌不了現了，但你還是把彩券收進皮夾。', '回程經過住宅區時，你看到二樓窗邊有手電筒在閃。'],
    openZones: AFTER_OPENING,
    shop: ['machete'],
  },
};

/** 新遊戲一開始能去的區域：只有主角自己的開局地點 */
export function startZones(hero: HeroId): string[] {
  return [OPENINGS[hero].zone];
}

/** 這位主角的完整主線：自己的第一章＋共用的第二到六章 */
export function chaptersFor(hero: HeroId): Chapter[] {
  return [OPENINGS[hero], ...CHAPTERS];
}

/** 第二章起三位主角共用 */
export const CHAPTERS: Chapter[] = [
  {
    id: 'window',
    title: '第二章　敲窗的人',
    minDay: 2,
    zone: 'homes',
    intro: ['昨晚住宅區的方向一直有光在閃，三短三長三短。', '是求救信號。', '如果那裡真的有人，你需要他，他也需要你。'],
    objective: '找到住宅區打信號的倖存者',
    finale: {
      id: 'story-window',
      title: '敲窗的人',
      text: '透天厝二樓的窗邊，一個男人舉著手電筒朝你揮手。樓下的鐵門被霧屍撞得框框作響。',
      weight: 0,
      options: [
        {
          label: '守住鐵門接應他',
          hint: '條件戰鬥：保護倖存者 20 秒',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'protect', title: '守住鐵門 20 秒，等他從二樓爬下來', zombies: 4, seconds: 20 },
            success: { text: '他從二樓跳下來，拍拍你的肩：「我叫阿哲，以前在靶場打工。槍給我，我幫你守夜。」', story: true, noise: 10 },
          },
        },
        {
          label: '從後巷爬上去',
          hint: '潛入：繞到後巷',
          action: {
            type: 'field',
            field: { mode: 'stealth', goal: 'reach', title: '從後巷摸到透天厝後門', zombies: 4 },
            clean: { text: '你們從後門溜了出來，一隻霧屍都沒驚動。他叫阿哲，還把藏著的左輪交給你。', story: true, bonus: { scrap: 10 } },
            success: { text: '一路殺出後巷。他叫阿哲，喘著氣把一把左輪塞給你。', story: true },
          },
        },
      ],
    },
    reward: { named: [{ role: 'shooter', name: '阿哲' }], weapons: ['python'], ammo: { '357': 24 } },
    outro: ['阿哲說他知道社區超市後面有個倉庫，保全室裡可能還有槍。', '從今晚起，守夜的不只你一個了。'],
    openZones: [],
    shop: ['coach', 'axe'],
  },
  {
    id: 'warehouse',
    title: '第三章　超市倉庫',
    minDay: 3,
    zone: 'market',
    intro: ['阿哲說的倉庫在超市收銀台後面。', '「保全室有一把霰彈槍，」他說，「最後一次看到時，保全還抱著它。」'],
    objective: '打開社區超市倉庫的保全室',
    finale: {
      id: 'story-warehouse',
      title: '倉庫鐵捲門',
      text: '保全室的鐵捲門卡住了，只開了一條縫。縫裡看得到一把雷明頓 870 靠在牆邊。四周的貨架後面傳來拖步聲。',
      weight: 0,
      options: [
        {
          label: '硬把鐵捲門撐開',
          hint: 'QTE 連打・失敗很吵',
          action: {
            type: 'qte',
            qte: { kind: 'mash', prompt: '連打把鐵捲門撐上去！', count: 18, time: 3.4 },
            success: { text: '鐵捲門嘎啦嘎啦地升起。雷明頓 870、整箱霰彈，還有保全的急救箱。', story: true, noise: 15 },
            fail: { text: '鐵捲門砸回地上，整間超市的霧屍都朝這裡湧來。你只能先撤。', noise: 40, hurt: 10 },
          },
        },
        {
          label: '邊撬邊守',
          hint: '條件戰鬥：撐 25 秒',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'survive', title: '撐 25 秒，等鐵捲門被撬開', zombies: 5, seconds: 25 },
            success: { text: '門開了。雷明頓 870 還上著膛。', story: true, noise: 15 },
          },
        },
      ],
    },
    reward: { weapons: ['r870'], ammo: { '12ga': 30 }, supplies: { medkit: 2 } },
    outro: ['倉庫的收音機收到一段斷斷續續的廣播：「這裡是市立醫院……還有人……藥局……」', '醫院離這裡很遠，要花半天。'],
    openZones: ['hospital'],
    shop: ['mp5'],
  },
  {
    id: 'hospital',
    title: '第四章　醫院的燈',
    minDay: 4,
    zone: 'hospital',
    intro: ['醫院三樓的藥局，每到黃昏就亮起一盞燈。', '有人在裡面，而且還活著。', '帶上醫療包，那裡的走廊擠滿了穿病人服的霧屍。'],
    objective: '救出市立醫院藥局裡的人',
    finale: {
      id: 'story-pharmacy',
      title: '藥局裡的燈',
      text: '藥局的門用病床堵著。一位穿白袍的女人隔著玻璃看你：「我出不去，牠們一直在撞門。」',
      weight: 0,
      options: [
        {
          label: '清空走廊',
          hint: '條件戰鬥：保護藥局 30 秒',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'protect', title: '守住藥局門口 30 秒', zombies: 5, seconds: 30 },
            success: { text: '她推開病床走出來：「我姓林，急診科的。你們據點缺醫生吧？」', story: true, noise: 15 },
          },
        },
        {
          label: '引開屍群',
          consume: 'decoy',
          hint: '用一個誘餌，安靜救人',
          action: { type: 'outcome', outcome: { text: '誘餌把走廊的霧屍引向樓梯間。林醫師抱著一箱藥跟你溜了出來。', story: true, bonus: { supplies: { medkit: 1 } } } },
        },
      ],
    },
    reward: { named: [{ role: 'medic', name: '林醫師' }], supplies: { medkit: 3 }, ammo: { '9mm': 60 } },
    outro: ['林醫師說，霧剛來時警察局把所有人的槍都收進了證物室。', '「拘留室裡還關著一個修車的，叫老周。」她頓了一下，「希望他還在。」'],
    openZones: ['police'],
    shop: ['sledge', 'm1014'],
  },
  {
    id: 'precinct',
    title: '第五章　證物室',
    minDay: 5,
    zone: 'police',
    intro: ['警察局的證物室裡有步槍，拘留室裡可能還有人。', '警員霧屍穿著防彈背心，打頭比較有效。'],
    objective: '打開警察局證物室與拘留室',
    finale: {
      id: 'story-evidence',
      title: '證物室與拘留室',
      text: '拘留室的鐵欄後坐著一個滿臉鬍渣的男人，手裡還握著一支扳手。證物室的門就在旁邊，幾隻警員霧屍守在走廊。',
      weight: 0,
      options: [
        {
          label: '開鎖放人',
          consume: 'lockpick',
          hint: '用開鎖工具，安靜打開',
          action: { type: 'outcome', outcome: { text: '鎖一開，他就站了起來：「老周，修車的。證物室密碼我知道。」', story: true } },
        },
        {
          label: '清空走廊再說',
          hint: '條件戰鬥：消滅全部',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'clear', title: '清掉證物室走廊的警員霧屍', zombies: 6 },
            success: { text: '走廊清乾淨了。老周從拘留室裡喊出證物室的密碼，門後是一把 M4A1。', story: true, noise: 20 },
          },
        },
      ],
    },
    reward: { named: [{ role: 'engineer', name: '老周' }], weapons: ['m4a1'], ammo: { '556': 90 }, supplies: { lockpick: 1 } },
    outro: ['老周翻著證物室的出勤紀錄：「軍方在城北設過檢查站，撤離失敗之後就沒人回來過。」', '「那裡有重武器，還有軍用無線電。」'],
    openZones: ['checkpoint'],
    shop: ['ak47', 'm4a1'],
  },
  {
    id: 'checkpoint',
    title: '第六章　撤離失敗',
    minDay: 7,
    zone: 'checkpoint',
    intro: ['城北的軍方檢查站。', '如果那台軍用無線電還能用，也許能聯絡上外面。', '這會是最危險的一趟。帶上最好的槍和手榴彈。'],
    objective: '奪下軍方檢查站的無線電',
    finale: {
      id: 'story-radio',
      title: '檢查站指揮車',
      text: '指揮車裡的無線電還亮著綠燈。四周是成群穿全套裝備的士兵霧屍，還有一頭被槍聲吵醒的屍熊。',
      weight: 0,
      options: [
        {
          label: '守住指揮車',
          hint: '條件戰鬥：撐 40 秒',
          action: {
            type: 'field',
            field: { mode: 'fight', goal: 'survive', title: '撐 40 秒，等老周拆下無線電', zombies: 7, seconds: 40 },
            success: { text: '無線電拆下來了。指揮車的武器架上還有一挺 M249。', story: true, noise: 25 },
          },
        },
        {
          label: '潛入指揮車',
          hint: '潛入：走到最右邊',
          action: {
            type: 'field',
            field: { mode: 'stealth', goal: 'reach', title: '溜進最右邊的指揮車', zombies: 6 },
            clean: { text: '沒有一聲槍響。你抱著無線電和一挺 M249 離開了檢查站。', story: true, bonus: { scrap: 20 } },
            success: { text: '被發現了，但你還是搶到了無線電和那挺 M249。', story: true },
          },
        },
      ],
    },
    reward: { weapons: ['m249'], ammo: { '556': 120, '762': 40 }, supplies: { grenade: 3 } },
    outro: EPILOGUE.lines,
    openZones: [],
    shop: ['mosin', 'm249'],
  },
];

/** 還沒進貨的武器：說明要怎麼拿到（軍械庫用） */
export function weaponUnlockHint(weaponId: string): string {
  const i = CHAPTERS.findIndex((c) => c.reward.weapons?.includes(weaponId));
  const j = CHAPTERS.findIndex((c) => c.shop.includes(weaponId));
  const short = (k: number) => CHAPTERS[k].title.split('　')[0];
  if (i >= 0 && (j < 0 || i <= j)) return `${short(i)}劇情取得`;
  if (j >= 0) return `完成${short(j)}後進貨`;
  return '探索中可能找到';
}
