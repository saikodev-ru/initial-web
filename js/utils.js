'use strict';
/* ══ UTILS — State · Cache · API · DOM helpers · Formatters · Emoji picker · Scroll ══ */

window.isSavedMsgs = c => !!(c && (c.is_saved_msgs || c.chat_id === -1));
window.isSystemChat = c => !!(c && (c.partner_is_system || c.chat_id === -2));
window.isOnline = ls => !!(ls && (Math.floor(Date.now()/1000) - ls < 300));
/* ══ APPLE EMOJI CDN ══════════════════════════════════════════ */
// Normalize emoji for comparison: strip variation selectors (\ufe0f \ufe0e)
// so '❤️' === '❤' in byMe checks regardless of how server stored them
function normEmoji(e){return String(e||'').replace(/[\ufe0e\ufe0f]/g,'');}
function emoImg(e,sz=22,cls=''){return`<span class="emo-s${cls?' '+cls:''}" style="font-size:${sz}px;line-height:1" title="${e}">${e}</span>`;}
const EMO_RE=/(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\u200d|\ufe0f)+/gu;
function mkEMORE(){return /(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\u200d(\p{Emoji_Presentation}|\p{Extended_Pictographic})|\ufe0f|[\u{1F3FB}-\u{1F3FF}])*/gu;}
document.getElementById('emo-smiley-img')?.remove();

const EMO_CATS=[
  {l:'😊',n:'Смайлы',e:['😀','😁','😂','🤣','😃','😄','😅','😆','😇','😉','😊','🙂','🙃','😋','😌','😍','🥰','😘','😗','😙','😚','🤩','🥳','😎','🤓','🧐','🤔','🤭','🤫','🤐','😐','😑','😶','😏','😒','🙄','😬','🤥','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','😳','🥺','😢','😭','😤','😠','😡','🤬','😈','👿','💀','💩','🤡','👻','👾','🤖']},
  {l:'👋',n:'Жесты',e:['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','✍','💪','🦾']},
  {l:'❤️',n:'Сердца',e:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💔','💕','💞','💓','💗','💖','💝','💘','💟','💯','🔥','⚡','✨','🌟','💫','⭐','🌈','🎉','🎊','🎈','🎁','🏆','🥇','🎯','💎']},
  {l:'🐶',n:'Природа',e:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦋','🐝','🌸','🌺','🌻','🌹','🌷','🍀','🌿','🌱','🌲','🌳','🌴','🍁','🌊','🌙','☀️','🌈','❄️']},
  {l:'🍕',n:'Еда',e:['🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🥦','🌽','🥕','🍞','🧀','🥚','🍳','🥞','🧇','🥓','🌭','🍔','🍟','🍕','🌮','🌯','🍣','🍱','🍛','🍜','🍝','🍤','🍗','🍖','🍦','🍧','🍩','🍪','🎂','🍰','🍫','🍬','🍭','☕','🍵','🥤','🍺','🍻','🥂','🍷','🍹','🍾']},
  {l:'⚽',n:'Активность',e:['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','🎿','🏂','🏋','🤸','🏊','🚴','🎮','🕹','🃏','🀄','🎲','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻']},
  {l:'✈️',n:'Символы',e:['✈️','🚀','🛸','🚗','🏎','🚕','🚌','🚑','🚒','🚲','🛵','🏠','🏰','⛪','🗼','🗽','🗺','🌍','🌎','🌏','🧭','🗻','🌋','🏝','🏜','🏕','🌃','🌆','🌇','🌉']},
];
const ALL_RXNS=['👍','❤️','🔥','😂','😮','😢','🎉','👎','🥰','😍','🤣','😅','😭','🤩','😎','🤔','🙏','💪','👏','🫶','✨','💯','😤','🤯','😱','💀','👀','💔','💥','🎊'];
// Frequency tracking for reactions
const RXN_FREQ_KEY='sg_rxn_freq';
function getRxnFreq(){try{return JSON.parse(localStorage.getItem(RXN_FREQ_KEY)||'{}')}catch{return{}}}
function bumpRxnFreq(emoji){const f=getRxnFreq();f[emoji]=(f[emoji]||0)+1;try{localStorage.setItem(RXN_FREQ_KEY,JSON.stringify(f))}catch{}}
function getSortedRxns(){
  const freq=getRxnFreq();
  // Put used reactions first (by frequency desc), then the rest in original order
  const used=ALL_RXNS.filter(e=>freq[e]).sort((a,b)=>(freq[b]||0)-(freq[a]||0));
  const rest=ALL_RXNS.filter(e=>!freq[e]);
  return [...used,...rest];
}
const QUICK_RXNS=ALL_RXNS; // kept for compatibility

/* ══ STATE ════════════════════════════════════════════════════ */
const API='https://initial.su/api';
function getMediaUrl(key) {
  if (!key) return '';
  if (key.startsWith('http') || key.startsWith('data:') || key.startsWith('blob:')) return key;
  const token = localStorage.getItem('sg_token') || (typeof S !== 'undefined' ? S.token : '');
  let url = API + '/get_media?key=' + encodeURIComponent(key);
  if (token) url += '&token=' + encodeURIComponent(token);
  return url;
}
const NS=(()=>{try{return JSON.parse(localStorage.getItem('sg_notif')||'{"enabled":false,"sound":true,"anon":false}');}catch{return {enabled:false,sound:true,anon:false};}})();
// enterSend: true = Enter sends, false = Ctrl+Enter sends (default: Enter)
const _enterSend=(()=>{try{const v=localStorage.getItem('sg_enter_send');return v!==null?v==='true':true;}catch{return true;}})();
const _quickReply=(()=>{try{const v=localStorage.getItem('sg_quick_reply');return v!==null?v==='true':true;}catch{return true;}})();
const _chatDividers=(()=>{try{return localStorage.getItem('sg_chat_dividers')!=='0';}catch{return true;}})();
const S={
  token:(()=>{try{return localStorage.getItem('sg_token');}catch{return null;}})(),
  user:(()=>{try{return JSON.parse(localStorage.getItem('sg_user')||'null');}catch{return null;}})(),
  chats:(()=>{try{const c=JSON.parse(localStorage.getItem('sg_cache_chats'));return Array.isArray(c)?c:[];}catch{return[];}})(),
  chatId:null,partner:null,
  msgs:{},lastId:{},rxns:{},
  replyTo:null,polling:null,typTimer:null,isTyping:false,
  pinDebounce: new Map(),
  rxnTick:0,syncTick:0,
  sse:null,
  _callSigInterval: null,
  viewItems:[],viewIdx:0,prevFiles:[],prevIdx:0,prevSpoiler:false,
  selected:new Set(),selectMode:false,
  notif:NS,
  enterSend:_enterSend,
  quickReply:_quickReply,
  chatDividers:_chatDividers,
};


/* ── Badge Helpers ─────────────────────────────────────────── */
function isVerified(c) {
  if (!c) return false;
  // If it's a full user object vs a chat object
  const sid = (c.partner_signal_id || c.signal_id || '').toLowerCase();
  const verified = !!(c.partner_is_verified || c.is_verified);
  const VERIFIED_IDS = ['initial'];
  return verified || VERIFIED_IDS.includes(sid);
}

function isTeamSignal(c) {
  if (!c) return false;
  return !!(c.partner_is_team_signal || c.is_team_signal);
}

// SVG для team_signal badge (ромб + гаечный ключ)
function teamBadgeSvg(size='sm') {
  const dim = size==='lg' ? 20 : size==='sm' ? 14 : 16;
  return `<svg class="team-badge ${size}" viewBox="0 0 24 24" fill="currentColor" width="${dim}" height="${dim}" title="Команда Initial" aria-label="Команда Initial" role="img"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 0.5 L22 6.2 L22 17.8 L12 23.5 L2 17.8 L2 6.2 Z M9.8 7.1 L11.5 8.7 L7.1 12 L11.5 15.3 L9.8 16.9 L4.3 12 Z M14.2 7.1 L19.7 12 L14.2 16.9 L12.6 15.3 L17 12 L12.6 8.7 Z"/></svg>`;
}

/* ══ CACHE ════════════════════════════════════════════════════ */
const CACHE_CHATS_KEY = 'sg_cache_chats';
const CACHE_MSGS_PFX  = 'sg_cache_msgs_';
const CACHE_MSGS_MAX  = 60; // messages to persist per chat

function cacheWriteChats(chats){
  try{ localStorage.setItem(CACHE_CHATS_KEY, JSON.stringify(chats)); }catch(e){}
}
function cacheReadChats(){
  try{ return JSON.parse(localStorage.getItem(CACHE_CHATS_KEY)||'null'); }catch{ return null; }
}
function cacheWriteMsgs(chatId, msgs){
  try{
    const tail=msgs.filter(m=>!isTemp(m.id)).slice(-CACHE_MSGS_MAX);
    localStorage.setItem(CACHE_MSGS_PFX+chatId, JSON.stringify(tail));
  }catch(e){}
}
function cacheReadMsgs(chatId){
  try{ return JSON.parse(localStorage.getItem(CACHE_MSGS_PFX+chatId)||'null'); }catch{ return null; }
}
function cacheDeleteChat(chatId){
  try{ localStorage.removeItem(CACHE_MSGS_PFX+chatId); }catch(e){}
  try{ localStorage.removeItem('sg_scroll_'+chatId); }catch(e){}
}

function saveScrollPos(chatId){
  const a=$('msgs');if(!a)return;
  const fromBottom=a.scrollHeight-a.scrollTop-a.clientHeight;
  try{localStorage.setItem('sg_scroll_'+chatId,String(Math.round(fromBottom)));}catch(e){}
}
function restoreScrollPos(chatId){
  const a=$('msgs');if(!a)return;
  try{
    // Use localStorage (not sessionStorage) so position survives page reload
    const lsScrollKey='sg_scroll_'+chatId;
    const v=localStorage.getItem(lsScrollKey);
    // If no saved position, go to bottom (first ever open)
    if(v===null){a.scrollTop=a.scrollHeight;return;}
    const fromBottom=parseInt(v,10);
    // fromBottom===0 means user was at the bottom → scroll to bottom
    if(fromBottom<=5){a.scrollTop=a.scrollHeight;return;}
    a.scrollTop=Math.max(0,a.scrollHeight-a.clientHeight-fromBottom);
  }catch(e){a.scrollTop=a.scrollHeight;}
}


const $=id=>document.getElementById(id);
const $$=sel=>document.querySelectorAll(sel);
function toast(msg,t=''){const el=document.createElement('div');el.className=`toast${t?' '+t:''}`;el.textContent=msg;$('toasts').appendChild(el);setTimeout(()=>{el.style.animation='toastOut .25s ease forwards';setTimeout(()=>el.remove(),250);},2800);}
function sysTost(msg){
  const el=document.createElement('div');el.className='sys-toast';el.textContent=msg;
  const ac=$('active-chat');if(!ac)return;ac.appendChild(el);
  setTimeout(()=>{el.style.animation='toastOut .25s ease forwards';setTimeout(()=>el.remove(),250);},2200);
}
function showScr(id){$$('.screen').forEach(s=>s.classList.add('hidden'));$(id).classList.remove('hidden');}
function openMod(id){$(id).classList.add('on');}
function closeMod(id){$(id).classList.remove('on');}
function showConfirm(title, text, onConfirm) {
  if (confirm(`${title}\n\n${text}`)) {
    onConfirm();
  }
}
function fmtTime(ts){return new Date(ts*1000).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});}
function fmtDate(ts){const d=new Date(ts*1000),n=new Date();if(n.toDateString()===d.toDateString())return 'Сегодня';const y=new Date(n);y.setDate(y.getDate()-1);if(y.toDateString()===d.toDateString())return 'Вчера';return d.toLocaleDateString('ru',{day:'numeric',month:'long'});}
function fmtChatTime(ts){if(!ts)return'';const d=new Date(ts*1000),n=new Date();const dStart=new Date(d.getFullYear(),d.getMonth(),d.getDate());const nStart=new Date(n.getFullYear(),n.getMonth(),n.getDate());const diff=Math.round((nStart-dStart)/86400000);if(diff===0)return fmtTime(ts);if(diff===1)return 'Вчера';if(d.getFullYear()===n.getFullYear())return d.toLocaleDateString('ru',{day:'numeric',month:'short'}).replace('.','');return d.toLocaleDateString('ru',{day:'2-digit',month:'2-digit',year:'2-digit'});}
function fmtLastSeen(ts){if(!ts)return 'не в сети';const diff=Date.now()-ts*1000;if(diff<60e3)return 'только что';if(diff<3600e3)return`${Math.floor(diff/60e3)} мин. назад`;const d=new Date(ts*1000),t=new Date();t.setHours(0,0,0,0);if(d>=t)return 'сегодня в '+fmtTime(ts);return d.toLocaleDateString('ru',{day:'numeric',month:'short'})+' в '+fmtTime(ts);}
function isOnline(ts){return ts&&(Date.now()/1000-ts)<90;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtBytes(b){return b<1024?b+'Б':b<1048576?(b/1024).toFixed(1)+'КБ':(b/1048576).toFixed(1)+'МБ';}
function _avatarColor(name){
  const palette=['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
  let h=0;const s=String(name||'');
  for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);
  return palette[Math.abs(h)%palette.length];
}

// ── Avatar shimmer-skeleton loading with dominant-colour cache ──
// On first load: shimmer uses name-based palette colour.
// After load: extract dominant pixel, cache by URL — next load uses real colour.
const _avColorCache=(()=>{try{return JSON.parse(localStorage.getItem('sg_av_colors')||'{}');}catch{return{};}})();

function _aviExtractColor(img){
  const url=img.dataset.url||img.src;
  if(url.toLowerCase().includes('.gif'))return; // GIF frame timing unreliable on mobile
  try{
    const cv=document.createElement('canvas');cv.width=cv.height=4;
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,4,4);
    const d=ctx.getImageData(0,0,4,4).data;
    let r=0,g=0,b=0,cnt=0;
    for(let i=0;i<d.length;i+=4){if(d[i+3]<10)continue;r+=d[i];g+=d[i+1];b+=d[i+2];cnt++;}
    if(!cnt)return;
    const col='rgb('+Math.round(r/cnt)+','+Math.round(g/cnt)+','+Math.round(b/cnt)+')';
    _avColorCache[url]=col;
    try{const st=JSON.parse(localStorage.getItem('sg_av_colors')||'{}');st[url]=col;localStorage.setItem('sg_av_colors',JSON.stringify(st));}catch{}
  }catch{}
}

function _aviLoaded(img){
  _aviExtractColor(img);
  const bg=img.previousElementSibling;
  if(bg&&bg.classList.contains('av-load-bg')){
    bg.style.transition='opacity .22s ease';
    bg.style.opacity='0';
    setTimeout(()=>{if(bg.parentNode)bg.remove();},250);
  }
  // GIF: no opacity transition — lets browser promote to GPU layer before animation plays
  const isGif=(img.dataset.url||img.src).toLowerCase().includes('.gif');
  if(isGif){img.style.opacity='1';}
  else{img.style.transition='opacity .22s ease';img.style.opacity='1';}
}
function _aviErr(img){
  img.onerror=null;
  const bg=img.previousElementSibling;
  if(bg&&bg.classList.contains('av-load-bg'))bg.remove();
  img.style.opacity='1';
}

function aviHtml(name,url){
  const ini=initials(name);
  const fallback=_avatarColor(name);
  if(url){
    const fullUrl = getMediaUrl(url);

    // Use cached dominant colour for shimmer background; fallback to name-based colour
    const bgCol=_avColorCache[fullUrl]||fallback;

    // Shimmer skeleton: solid colour + animated white-sweep.
    // position:absolute fills .av-img (which has position:relative + overflow:hidden).
    // Destroyed by _aviLoaded() after image loads — not rendered in background.
    const shimmer='<div class="av-load-bg" style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:inherit;'
      +'background:'+bgCol+';background-image:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.22) 50%,transparent 100%);'
      +'background-size:200% 100%;animation:skelShimmer 1.4s ease-in-out infinite;pointer-events:none"></div>';

    // Image is invisible until fully loaded — shimmer is the only visible element.
    // data-url stored for colour cache keying.
    const isGif = /\.gif(?:\?|#|$)/i.test(fullUrl);
    let img;
    if (isGif) {
      img = '<canvas data-gif-url="'+esc(fullUrl)+'" data-url="'+esc(fullUrl)+'" style="width:100%;height:100%;object-fit:cover;display:block;position:relative;border-radius:inherit" onload="this._gifInit||_gifCanvasInit(this)" onerror="_aviErr(this)"></canvas>';
    } else {
      img = '<img src="'+esc(fullUrl)+'" data-url="'+esc(fullUrl)+'" alt="" '
        +'style="width:100%;height:100%;object-fit:cover;display:block;position:relative;opacity:0" '
        +'onload="_aviLoaded(this)" onerror="_aviErr(this)">';
    }
    return shimmer+img;
  }
  return '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:'+fallback+';color:#fff;">'+ini+'</div>';
}
function initials(n){if(!n)return'?';return n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function isTemp(id){return typeof id==='string'&&id.startsWith('t');}
function saveNotif(){localStorage.setItem('sg_notif',JSON.stringify(S.notif));}

function applyBlurredAvatarBg(containerId, name, url) {
  const bg = document.getElementById(containerId);
  if (!bg) return;
  if (url) {
    const fullUrl = getMediaUrl(url);

    const imgDiv = document.createElement('div');
    imgDiv.className = 'blur-bg-img';
    imgDiv.style.backgroundImage = `url("${fullUrl}")`;
    const ov = document.createElement('div');
    ov.className = 'blur-bg-ov';
    bg.innerHTML = ''; bg.appendChild(imgDiv); bg.appendChild(ov);
    return;
  }
  bg.innerHTML = '';
}

/* ══ GIF AVATAR SYNC ═══════════════════════════════════════════════
   One hidden <img> per GIF URL + rAF loop paints frames to all
   visible <canvas> elements — prevents desync between chat list
   and chat header. ═══════════════════════════════════════════════ */
const _gifSources = new Map(); // url → { img, canvases: Set<canvas> }
let _gifRafId = null;

function _gifLoop() {
  _gifSources.forEach((entry) => {
    entry.canvases.forEach((cv) => {
      if (!cv.isConnected) { entry.canvases.delete(cv); return; }
      try {
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawImage(entry.img, 0, 0, cv.width, cv.height);
        }
      } catch(e) {}
    });
    if (entry.canvases.size === 0) entry.img.remove();
  });
  // Clean empty entries
  for (const [url, entry] of _gifSources) {
    if (entry.canvases.size === 0) _gifSources.delete(url);
  }
  _gifRafId = _gifSources.size > 0 ? requestAnimationFrame(_gifLoop) : null;
}

function _registerGifCanvas(url, canvas) {
  if (!_gifSources.has(url)) {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;opacity:0;';
    document.body.appendChild(img);
    _gifSources.set(url, { img, canvases: new Set() });
  }
  _gifSources.get(url).canvases.add(canvas);
  if (!_gifRafId) _gifRafId = requestAnimationFrame(_gifLoop);
}

function _unregisterGifCanvas(url, canvas) {
  const entry = _gifSources.get(url);
  if (entry) entry.canvases.delete(canvas);
}

window._registerGifCanvas = _registerGifCanvas;
window._unregisterGifCanvas = _unregisterGifCanvas;

function _gifCanvasInit(canvas) {
  canvas._gifInit = true;
  const url = canvas.dataset.gifUrl;
  if (!url) return;
  const entry = _gifSources.get(url);
  if (entry && entry.img.naturalWidth) {
    canvas.width = 88;  // 2x for retina
    canvas.height = 88;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(entry.img, 0, 0, 88, 88);
    _registerGifCanvas(url, canvas);
    canvas.style.opacity = '1';
    // Remove shimmer
    const shimmer = canvas.parentElement?.querySelector('.av-load-bg');
    if (shimmer) shimmer.remove();
    return;
  }
  // Source not loaded yet — load it now
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (!canvas.isConnected) return;
    canvas.width = 88;
    canvas.height = 88;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 88, 88);
    _registerGifCanvas(url, canvas);
    canvas.style.opacity = '1';
    const shimmer = canvas.parentElement?.querySelector('.av-load-bg');
    if (shimmer) shimmer.remove();
  };
  img.onerror = () => { _aviErr(canvas); };
  img.src = url;
}
window._gifCanvasInit = _gifCanvasInit;


function fmtText(raw){
  if(!raw)return'';
  const cb=[];
  // 1) Extract URLs and @mentions BEFORE html-escaping, stash them in cb[]
  let pre=raw.replace(/(https?:\/\/[^\s<>"'\x00-\x1f\u200B]+)/g,u=>{
    const clean=u.replace(/[.,!?;:]+$/,''); // strip trailing punctuation
    const href=esc(clean);
    const trail=esc(u.slice(clean.length));
    cb.push(`<a href="${href}" target="_blank" rel="noopener noreferrer" class="msg-link">${href}</a>${trail}`);
    return'\x00'+(cb.length-1)+'\x00';
  });
  pre=pre.replace(/(?<![a-zA-Z0-9_@])@([a-zA-Z0-9_]{2,32})(?![a-zA-Z0-9_])/g,(_,name)=>{
    cb.push(`<span class="mention">@${esc(name)}</span>`);
    return'\x00'+(cb.length-1)+'\x00';
  });
  // 2) Escape remaining text (placeholders \x00N\x00 survive esc because digits+\x00 have no html special chars)
  let s=esc(pre);
  s=s.replace(/```([\s\S]*?)```/g,(_,c)=>{cb.push(`<pre>${c}</pre>`);return`\x00${cb.length-1}\x00`;});
  s=s.replace(/`([^`\n]+)`/g,(_,c)=>{cb.push(`<code>${c}</code>`);return`\x00${cb.length-1}\x00`;});
  s=s.replace(/\*\*(.+?)\*\*/g,(_,c)=>`<strong>${c}</strong>`);
  s=s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,(_,c)=>`<em>${c}</em>`);
  s=s.replace(/~~(.+?)~~/g,(_,c)=>`<del>${c}</del>`);
  s=s.replace(/__(.+?)__/g,(_,c)=>`<u>${c}</u>`);
  s=s.replace(/\|\|(.+?)\|\|/g,(_,c)=>`<span class="spoiler">${c}</span>`);
  s=s.replace(/\x00(\d+)\x00/g,(_,i)=>cb[+i]);
  return s;
}
function fmtPreview(raw){
  if(!raw)return'';
  let s=esc(raw);
  s=s.replace(/```([\s\S]*?)```/g, '`$1`');
  s=s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s=s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s=s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s=s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s=s.replace(/__(.+?)__/g, '<u>$1</u>');
  s=s.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
  s=s.replace(/(https?:\/\/[^\s<>"'\x00-\x1f\u200B]+)/g, '<span class="msg-link">$1</span>');
  s=s.replace(/(?<![a-zA-Z0-9_@])@([a-zA-Z0-9_]{2,32})(?![a-zA-Z0-9_])/g, '<span class="mention">@$1</span>');
  return s;
}
function hideSpoilerText(text){
  if(!text)return '';
  return text.replace(/\|\|([\s\S]*?)\|\|/g, (_, m) => {
    const b = ['⡿','⣟','⣯','⣷','⣾','⣽','⣻','⢿','⣿','⣶'];
    return [...m].map((c, i) => c.trim() ? b[(c.charCodeAt(0) + i) % b.length] : c).join('');
  });
}
function walkTextNodes(el){
  if(!el)return;
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null,false);
  const nodes=[];
  let n;while((n=walker.nextNode()))nodes.push(n);
  nodes.forEach(node=>{
    const txt=node.textContent;
    if(!mkEMORE().test(txt))return;
    const frag=emojiToFrag(txt,false);
    node.parentNode.replaceChild(frag,node);
  });
}
// Shorthand — walk and return el for chaining
function wtn(el){if(el)walkTextNodes(el);return el;}

// Detect if text is ONLY emoji (no other chars except whitespace)
function isEmojiOnly(text){
  const t=(text||'').trim();
  if(!t)return false;
  // Strip all emoji and check nothing remains
  const stripped=t.replace(mkEMORE(),'').replace(/\s/g,'');
  return stripped.length===0;
}
// Count emoji in text
function countEmoji(text){
  return((text||'').match(mkEMORE())||[]).length;
}

/* ── Marquee for long nicknames ── */
function checkMarquee(innerEl) {
  if (!innerEl) return;
  const wasOverflow = innerEl.style.overflow;
  const wasTextOverflow = innerEl.style.textOverflow;
  innerEl.classList.remove('is-scrolling');
  innerEl.style.removeProperty('--overflow-w');
  // Restore non-scrolling fallback styles
  if (wasOverflow) innerEl.style.overflow = wasOverflow;
  if (wasTextOverflow) innerEl.style.textOverflow = wasTextOverflow;
  const parent = innerEl.parentElement;
  if (!parent) return;
  
  requestAnimationFrame(() => {
    const diff = innerEl.scrollWidth - parent.clientWidth;
    if (diff > 2) {
      innerEl.style.setProperty('--overflow-w', diff + 'px');
      innerEl.classList.add('is-scrolling');
      // Remove inline overflow styles so CSS .is-scrolling rules take effect
      innerEl.style.removeProperty('overflow');
      innerEl.style.removeProperty('text-overflow');
    }
  });
}
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    document.querySelectorAll('.marquee-inner').forEach(checkMarquee);
  }, 150);
});

async function api(ep,method='GET',body=null,fd=false,signal=null){
  const opts={method,headers:{}};
  if(S.token)opts.headers['Authorization']=`Bearer ${S.token}`;
  if(body&&!fd){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  else if(body)opts.body=body;
  if(signal)opts.signal=signal;
  try{
    const cleanEp = ep.replace(/\.php(\?|$)/, '$1'); // 
    const r=await fetch(`${API}/${cleanEp}`,opts);
    let data = null;
    try { data = await r.json(); } catch(e) {}

    if(r.status===401){
      // Защита от вылетов при обновлении бэкенда (сервер может временно терять заголовки)
      // Разлогиниваем только если сервер явно сообщил, что токен протух
      if (!data || data.message === 'Токен недействителен или истёк' || !S.token) logout();
      return data || {ok:false, error:'auth'};
    }
    if(!data) throw new Error('parse error');

    window._onApiOk?.();
    return data;
  }
  catch(e){
    if(e&&e.name==='AbortError')throw e;
    window._onApiError?.();
    return{ok:false,error:'network',message:'Ошибка сети'};
  }
}

/* XHR-based upload with real progress callback (needed for the ring) */
function uploadFileXHR(file,signal,onProgress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST', `${API}/upload_media`);
    if(S.token)xhr.setRequestHeader('Authorization',`Bearer ${S.token}`);
    xhr.upload.onprogress=e=>{if(e.lengthComputable&&onProgress)onProgress(e.loaded/e.total);};
    xhr.onload=()=>{
      if(xhr.status===401){logout();reject(Object.assign(new Error('auth'),{name:'AuthError'}));return;}
      try{resolve(JSON.parse(xhr.responseText));}catch{resolve({ok:false,error:'parse'});}
    };
    xhr.onerror=()=>resolve({ok:false,error:'network'});
    xhr.onabort=()=>{const e=new Error('AbortError');e.name='AbortError';reject(e);};
    if(signal)signal.addEventListener('abort',()=>xhr.abort(),{once:true});
    const fd=new FormData();fd.append('file',file);xhr.send(fd);
  });
}

/* ══ NOTIFICATIONS ════════════════════════════════════════════ */

// ── Audio unlock ─────────────────────────────────────────────
// Browsers block audio until a user gesture. We create the Audio objects
// normally, then on the first interaction we play+pause them at volume 0
/* ══ NOTIFICATIONS ════════════════════════════════════════════ */

const _notifAudio = new Audio('audio/notification-active.mp3');
_notifAudio.preload = 'auto';
let _audioUnlocked = false;
function _unlockAudio(){
  if(_audioUnlocked) return;
  _audioUnlocked = true;
  _notifAudio.volume = 0;
  _notifAudio.play().then(()=>{ _notifAudio.pause(); _notifAudio.currentTime=0; _notifAudio.volume=1; }).catch(()=>{ _notifAudio.volume=1; });
}
document.addEventListener('click',   _unlockAudio, {once:true, passive:true});
document.addEventListener('keydown',  _unlockAudio, {once:true, passive:true});
document.addEventListener('touchstart',_unlockAudio,{once:true, passive:true});

function playNotifSound(){
  if(!S.notif.sound) return;
  // No sound when window is focused
  if(document.hasFocus()) return;
  _notifAudio.volume = 0.5;
  try{ _notifAudio.currentTime=0; _notifAudio.play().catch(()=>{}); }catch(e){}
}

async function requestNotifPermission(){
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied')  return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function showNotif(senderName, body, chatId){
  // Skip if SW already showed a background notification for this chat
  if (window._fcmBgHandled && chatId &&
      window._fcmBgHandled.chatId == chatId &&
      Date.now() - window._fcmBgHandled.ts < 8000) return;

  playNotifSound();
  if(!S.notif.enabled) return;
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  if(document.hasFocus()) return;
  const title = S.notif.anon ? 'Инициал' : senderName;
  const text  = S.notif.anon ? 'Новое сообщение' : (body||'').slice(0, 80);
  const tag   = 'signal-' + senderName.replace(/\s+/g,'-');
  try{
    const n = new Notification(title, {body:text, tag, renotify:true});
    n.onclick = ()=>{ window.focus(); n.close(); };
    setTimeout(()=>n.close(), 8000);
  }catch(e){}
}


/* ══ EMOJI PICKER ════════════════════════════════════════════ */
let emoMode='input',emoMsgId=null,activeCat=0;
function buildEmoPicker(){
  const tabs=$('emo-tabs');
  EMO_CATS.forEach((cat,i)=>{
    const tab=document.createElement('button');tab.className='emo-tab'+(i===0?' on':'');tab.title=cat.n;
    tab.innerHTML=emoImg(cat.l,20);
    tab.onclick=()=>{activeCat=i;showEmoCat(i);$$('.emo-tab').forEach((t,j)=>t.classList.toggle('on',j===i));};
    tabs.appendChild(tab);
  });showEmoCat(0);
}
function showEmoCat(idx){
  const wrap=$('emo-grid-wrap'),cat=EMO_CATS[idx];
  wrap.innerHTML=`<span class="emo-label">${cat.n}</span><div class="emo-grid" id="emo-g"></div>`;
  const grid=document.getElementById('emo-g');
  cat.e.forEach(e=>{const btn=document.createElement('button');btn.className='ebtn';btn.innerHTML=emoImg(e,28);btn.title=e;btn.onclick=()=>onEmojiPick(e);grid.appendChild(btn);});
}
function onEmojiPick(emoji){
  if(emoMode==='input'){
    // Не закрываем пикер — пользователь может вставить несколько emoji подряд
    mfield.focus();
    // contentEditable="false" prevents cursor from ever entering the span
    document.execCommand('insertHTML',false,`<span class="emo-field" contenteditable="false">${emoji}</span>&#8203;`);
  } else if(emoMode==='input-name' || emoMode==='pm-name' || emoMode==='pm-bio'){
    const map = {'input-name': 'inp-name', 'pm-name': 'pm-name', 'pm-bio': 'pm-bio'};
    const f=$(map[emoMode]);if(!f)return;
    const pos=f.selectionStart||f.value.length;
    f.value=f.value.slice(0,pos)+emoji+f.value.slice(pos);f.focus();f.setSelectionRange(pos+emoji.length,pos+emoji.length);
    // Искусственно вызываем input, чтобы подсветить кнопку сохранения
    f.dispatchEvent(new Event('input'));
  } else if(emoMode==='reaction'&&emoMsgId&&!isTemp(emoMsgId)){
    $('epicker').classList.remove('on');
    const existing=(S.rxns[+emoMsgId]||[]).find(r=>normEmoji(r.emoji)===normEmoji(emoji)&&r.by_me);
    toggleRxn(+emoMsgId,emoji,!!existing);
  }
}
$('emo-q').oninput=()=>{
  const q=$('emo-q').value.trim().toLowerCase();if(!q){showEmoCat(activeCat);return;}
  const wrap=$('emo-grid-wrap');const all=EMO_CATS.flatMap(c=>c.e).filter(e=>e.includes(q));
  wrap.innerHTML='<span class="emo-label">Результаты</span><div class="emo-grid" id="emo-g"></div>';
  const grid=document.getElementById('emo-g');
  all.slice(0,42).forEach(e=>{const btn=document.createElement('button');btn.className='ebtn';btn.innerHTML=emoImg(e,28);btn.title=e;btn.onclick=()=>onEmojiPick(e);grid.appendChild(btn);});
};
function openEmoPicker(x,y,mode,msgId){
  emoMode=mode;emoMsgId=msgId||null;
  const p=$('epicker');
  

  const isMobile=__isMobileView();
  if(isMobile){
    if (mode === 'input') {
      const IZ=$('input-zone');
      if(IZ && p.parentNode !== IZ) {
        IZ.insertBefore(p, IZ.firstChild);
      }
      p.style.cssText='';
      p.classList.add('on');
    } else {
      if(p.parentNode !== document.body) document.body.appendChild(p);
      p.style.cssText = 'position:fixed; bottom:0; left:0; right:0; width:100%; border-radius:18px 18px 0 0; z-index:2000; max-height:50vh; box-shadow:0 -4px 24px rgba(0,0,0,.6);';
      p.classList.add('on');
    }
    return;
  }

  if(p.parentNode !== document.body) document.body.appendChild(p);
  p.style.cssText='position:fixed; z-index:2000;';
  p.style.width='';
  const PICKER_W=320;
  const GAP=6;
  const MIN_MARGIN=8;

  p.style.visibility='hidden';
  p.style.top='-9999px';
  p.style.left='-9999px';
  p.classList.add('on');

  requestAnimationFrame(()=>{
    const pickerH=p.offsetHeight||340;
    let top, left;
    
    if (mode === 'input') {
      top = Math.max(MIN_MARGIN, y - pickerH - GAP);
      left = Math.max(MIN_MARGIN, Math.min(x - PICKER_W, window.innerWidth - PICKER_W - MIN_MARGIN));
    } else {
      top = y + GAP;
      if (top + pickerH > window.innerHeight - MIN_MARGIN) {
        top = y - pickerH - GAP - 30;
      }
      left = Math.max(MIN_MARGIN, Math.min(x - PICKER_W, window.innerWidth - PICKER_W - MIN_MARGIN));
    }

    p.style.top=top+'px';
    p.style.left=left+'px';
    p.style.visibility='';
  });
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.epicker')&&!e.target.closest('.emo-btn-in')&&!e.target.closest('.ctxmenu')&&!e.target.closest('.pm-emo-btn')&&!e.target.closest('.field-emo-btn')){
    const ep=$('epicker');
    if (ep.classList.contains('on')) {
      ep.classList.remove('on');
      ep.style.cssText = '';
      // On desktop restore fixed positioning context (move back to body)
      if(!__isMobileView() && ep.parentNode !== document.body){
        document.body.appendChild(ep);
      }
    }
    $('btn-emo-in').classList.remove('active');
  }
});
// Emoji picker for text fields (registration & profile settings)
document.addEventListener('click',e=>{
  const t = e.target.closest('#btn-emo-name, #btn-emo-pm-name, #btn-emo-pm-bio');
  if(t){
    e.stopPropagation();
    const ep = $('epicker');
    let tgtMode = '';
    if(t.id === 'btn-emo-name') tgtMode = 'input-name';
    else if(t.id === 'btn-emo-pm-name') tgtMode = 'pm-name';
    else if(t.id === 'btn-emo-pm-bio') tgtMode = 'pm-bio';

    const map = {'input-name': 'inp-name', 'pm-name': 'pm-name', 'pm-bio': 'pm-bio'};
    const f = $(map[tgtMode]);

    if (ep.classList.contains('on') && emoMode === tgtMode) {
      ep.classList.remove('on');
      ep.style.cssText = '';
      if (!__isMobileView() && ep.parentNode !== document.body) document.body.appendChild(ep);
      if (f && !__isMobileView()) f.focus();
      return;
    }

    const r = t.getBoundingClientRect();
    openEmoPicker(r.right, r.bottom, tgtMode, null);
    if (f && !__isMobileView()) f.focus();
  }
});
buildEmoPicker();
let _scrollBotRaf=0;
function scrollBot(){
  if(_scrollBotRaf)return;
  _scrollBotRaf=requestAnimationFrame(()=>{
    _scrollBotRaf=0;
    const a=$('msgs');if(!a)return;
    a.scrollTo({top:a.scrollHeight,behavior:'smooth'});
    hideSBBtn();
  });
}
function nearBot(){const a=$('msgs');return a.scrollHeight-a.scrollTop-a.clientHeight<130;}
/* Run fn() while keeping the visual scroll position frozen (no jitter).
   Measures fromBottom before, restores after a rAF so layout has settled. */
function withScrollAnchor(fn){
  const a=$('msgs');if(!a)return fn();
  const before=a.scrollHeight-a.scrollTop;
  fn();
  // Применяем scroll синхронно до следующего кадра отрисовки,
  // чтобы контент не "прыгал" при добавлении сообщений сверху.
  a.scrollTop=a.scrollHeight-before;
  requestAnimationFrame(()=>{a.scrollTop=a.scrollHeight-before;});
}
/* Expand upward: pin to bottom of a specific element so growth goes up. */
function withElementAnchor(el,fn){
  const a=$('msgs');if(!a||!el)return fn();
  const elBottom=el.getBoundingClientRect().bottom;
  const aBottom=a.getBoundingClientRect().bottom;
  const gap=aBottom-elBottom; // pixels from element bottom to viewport bottom
  fn();
  requestAnimationFrame(()=>{
    const newElBottom=el.getBoundingClientRect().bottom;
    const shift=newElBottom-(aBottom-gap);
    if(shift>1)a.scrollTop+=shift;
  });
}
/* ══ MSG GROUPING ════════════════════════════════════════════ */
function _applyGroupRow(row, prev, next){
  row.classList.remove('grp-single','grp-top','grp-mid','grp-bot');
  const sid=row.dataset.sid;
  const sp=prev?.dataset?.sid===sid, sn=next?.dataset?.sid===sid;
  if(!sp&&!sn)row.classList.add('grp-single');
  else if(!sp&&sn)row.classList.add('grp-top');
  else if(sp&&sn)row.classList.add('grp-mid');
  else row.classList.add('grp-bot');
}
/* Full scan — only for initial render / prepend (one-time cost) */
function applyGroupClasses(area){
  const rows=[...area.querySelectorAll('.mrow')];
  rows.forEach((row,i)=>_applyGroupRow(row, rows[i-1], rows[i+1]));
}
/* Fast tail update — O(1), used when appending 1-2 messages */
function applyGroupClassesTail(area){
  const rows=area.querySelectorAll('.mrow');
  const n=rows.length;
  if(!n)return;
  // Only the last two rows can change when a new row is appended at the end
  if(n>=2)_applyGroupRow(rows[n-2], rows[n-3]||null, rows[n-1]);
  _applyGroupRow(rows[n-1], rows[n-2]||null, null);
}
