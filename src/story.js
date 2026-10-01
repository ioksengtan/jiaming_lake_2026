// 遊記內容。每一步（step）對應路線上的一個位置：
//   d     距登山口的公尺數（見 data/route.json 的 waypoints）
//   leg   'out' 去程、'back' 回程
//   photos 照片編號（data/photos.json 的 id 去掉拍攝者前綴，見 owner）
// 章節的 map：from、to 是這一章走的路段（單程距離，回程 from 大於 to）；lake 是湖的近景
//   text  內文段落；todo 是還沒寫或還缺素材的提醒，上線前要清空
export const chapters = [
  {
    kicker: '第一天｜9 月 24 日',
    title: '從公路邊走進森林',
    map: { from: 0, to: 3250, label: '戒茂斯登山口 → 新武呂溪營地' },
    steps: [
      {
        time: '2026-09-24 15:11', place: '戒茂斯登山口', d: 0, leg: 'out',
        photos: ['me-IMG_4340'],
        text: [],
        todo: ['待寫：為什麼選戒茂斯、不走向陽；下午三點才出發的原因；背包裡帶了什麼。'],
      },
      {
        time: '2026-09-24 16:06', place: '戒茂斯山前峰', d: 350, leg: 'out',
        photos: ['me-IMG_4342'],
        text: [],
        todo: ['待寫：第一個山頭。時間不夠，沒有去戒茂斯山。'],
      },
      {
        time: '2026-09-24 夜', place: '新武呂溪營地', d: 3250, leg: 'out',
        photos: [],
        text: [],
        todo: ['待寫：下切到溪邊的過程、第一晚。', '缺照片：16:06 之後沒有照片，等隊友的素材。'],
      },
    ],
  },
  {
    kicker: '第二天｜9 月 25 日',
    title: '過溪，然後一直往上',
    map: { from: 3250, to: 8950, label: '新武呂溪營地 → 妹池營地' },
    steps: [
      {
        time: '2026-09-25 10:23', place: '新武呂溪渡溪點', d: 3270, leg: 'out',
        photos: [],
        text: [],
        todo: ['待寫：脫鞋、拉繩、溪水的溫度。', '照片與 65 秒影片已有，等隊友同意露臉後放上。'],
      },
      {
        time: '2026-09-25 10:48', place: '溪畔森林', d: 3300, leg: 'out',
        photos: ['me-IMG_4351', 'me-IMG_4352'],
        text: [],
        todo: ['待寫：苔蘚、松蘿、礫石灘。'],
      },
      {
        time: '2026-09-25 11:50', place: '松林', d: 3850, leg: 'out',
        photos: [],
        text: [],
        todo: ['待寫：休息、午餐。', '照片已有，等隊友同意露臉後放上。'],
      },
      {
        time: '2026-09-25 14:27', place: '海拔 2,770 公尺', d: 5250, leg: 'out',
        photos: ['me-IMG_4368', 'me-IMG_4373'],
        text: [],
        todo: ['待寫：這裡是哪個營地？背水的事。'],
      },
      {
        time: '2026-09-25 傍晚', place: '妹池營地', d: 8950, leg: 'out',
        photos: [],
        text: [],
        todo: ['待寫：抵達妹池、第二晚。', '缺照片：14:55 之後沒有照片，等隊友的素材。'],
      },
    ],
  },
  {
    kicker: '第三天｜9 月 26 日',
    title: '稜線上，湖出現了',
    map: { from: 8950, to: 10243, label: '妹池營地 → 嘉明湖' },
    steps: [
      {
        time: '2026-09-26 10:15', place: '草原稜線', d: 9700, leg: 'out',
        photos: ['me-IMG_4375', 'me-IMG_4376'],
        text: [],
        todo: ['待寫：出了森林，視野打開。遠方那座山是哪一座？'],
      },
      {
        time: '2026-09-26 11:12', place: '第一眼看到嘉明湖', d: 10000, leg: 'out',
        photos: ['me-IMG_4377'],
        text: [],
        todo: ['待寫：第一眼的感覺。'],
      },
    ],
  },
  {
    lake: true,
    kicker: '海拔 3,310 公尺',
    title: '嘉明湖',
    map: { from: 9900, to: 10243, lake: true, label: '嘉明湖與三叉山' },
    steps: [
      {
        time: '2026-09-26 13:10', place: '嘉明湖', d: 10243, leg: 'out',
        photos: ['me-IMG_4378', 'me-IMG_4382'],
        text: [],
        todo: [
          '待寫：湖本身的故事。兩小時前還是深藍色，走到湖邊已經變成灰銀色。',
          '待查證並附來源：湖的大小與深度、成因（隕石說、冰河說）、布農族的名字與傳說。',
        ],
        card: [
          ['海拔', '3,310 m'],
          ['距登山口', '10.2 km'],
          ['累積爬升', '約 2,100 m'],
          ['抵達時間', '第三天 13:10'],
        ],
      },
    ],
  },
  {
    kicker: '回程｜9 月 26 日下午至 27 日',
    title: '同一條路，倒著走',
    map: { from: 10243, to: 0, label: '嘉明湖 → 戒茂斯登山口' },
    steps: [
      {
        time: '2026-09-26 14:15', place: '回到營地', d: 9373, leg: 'back',
        photos: ['me-IMG_4383', 'me-IMG_4384'],
        text: [],
        todo: ['待寫：收帳、準備下撤。'],
      },
      {
        time: '2026-09-26 15:04', place: '妹池', d: 8950, leg: 'back',
        photos: ['me-IMG_4385'],
        text: [],
        todo: ['待寫：回望。接下來要下降將近一千公尺回到溪邊。'],
      },
      {
        time: '2026-09-27 07:52', place: '新武呂溪', d: 3250, leg: 'back',
        photos: ['me-IMG_4386', 'me-IMG_4388'],
        text: [],
        todo: ['待寫：第三晚、清晨的溪床。'],
      },
      {
        time: '2026-09-27 11:25', place: '下山途中', d: 700, leg: 'back',
        photos: ['me-IMG_4390'],
        text: [],
        todo: ['待寫：最後一張照片。'],
      },
      {
        time: '2026-09-27 午後', place: '戒茂斯登山口', d: 0, leg: 'back',
        photos: [],
        text: [],
        todo: ['待寫：尾聲。'],
      },
    ],
  },
]
