// Host-authoritative transport. PeerJS Cloud provides signalling only; game
// packets travel through a WebRTC data channel. No camera/microphone is used.
const VERSION=4, MAX_BYTES=128*1024, MAX_GUESTS=3;
const ROOM_PATTERN=/^outpost-[a-f0-9]{16}$/;
const PUBLISHED_URL='https://last-outpost-zombies-lz-n13.harmoniousknot1.chatgpt.site/';
const cleanName=value=>String(value||'Выживший').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,24)||'Выживший';
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');

// STUN alone only works when a direct path exists. Players behind strict NAT
// (mobile data, carrier-grade NAT) need a TURN relay. Configure ONE of:
// 1) Static credentials (ExpressTURN, Xirsys, own coturn), for example:
//      {urls:['turn:<host>:3478','turn:<host>:3478?transport=tcp'],username:'<user>',credential:'<password>'}
const TURN_SERVERS=[];
// 2) A credentials endpoint that returns an iceServers array (Metered Open Relay):
//      https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>
const TURN_CREDENTIALS_URL='';
// With both empty the game runs STUN-only.
const STUN_SERVERS=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}];
// Open the game with ?relay=1 to force all traffic through TURN (tests the relay path).
const FORCE_RELAY=new URLSearchParams(window.location.search).get('relay')==='1';
const TURN_CACHE_MS=10*60*1000;
let turnCache=null;

async function loadIceServers(){
  if(TURN_SERVERS.length)return {servers:[...STUN_SERVERS,...TURN_SERVERS],turn:true};
  if(!TURN_CREDENTIALS_URL)return {servers:STUN_SERVERS,turn:false};
  if(turnCache&&turnCache.expires>Date.now())return turnCache.result;
  const controller=new AbortController();
  const abort=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(TURN_CREDENTIALS_URL,{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const relays=await response.json();
    if(!Array.isArray(relays)||!relays.length)throw new Error('empty iceServers list');
    const result={servers:[...STUN_SERVERS,...relays],turn:true};
    turnCache={result,expires:Date.now()+TURN_CACHE_MS};
    return result;
  }catch(error){
    console.warn('TURN credentials unavailable, falling back to STUN only:',error);
    return {servers:STUN_SERVERS,turn:false};
  }finally{clearTimeout(abort);}
}

export function parseRoom(value){
  let room=String(value||'').trim();
  if(room.includes('://')){try{room=new URL(room).searchParams.get('room')||'';}catch{room='';}}
  if(/^[a-f0-9]{16}$/.test(room))room='outpost-'+room;
  if(!ROOM_PATTERN.test(room))throw new Error('Вставь код комнаты или ссылку-приглашение целиком.');
  return room;
}

export function createNetwork(callbacks={}){
  let peer=null,hostConnection=null,generation=0,pending=null,heartbeat=null;
  const connections=new Map(),timers=new Set();
  const net={role:'solo',id:null,room:null,name:'Выживший',peers:new Map(),host,join,send,broadcast,leave,getInviteURL};
  const emit=(name,...args)=>{try{callbacks[name]?.(...args);}catch(error){console.error('Network callback:',error);}};
  const timer=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);return t;};
  const clearTimer=t=>{clearTimeout(t);timers.delete(t);};
  const status=text=>emit('onStatus',text);
  function packetFits(data){try{return new TextEncoder().encode(JSON.stringify(data)).byteLength<=MAX_BYTES;}catch{return false;}}
  function write(connection,data){
    if(!connection?.open||!packetFits(data))return false;
    // Stale snapshots should never build an unbounded reliable-channel queue.
    const snapshot=data?.type==='snapshot'||data?.type==='state'||data?.t==='snapshot'||data?.t==='state';
    if(snapshot&&((connection.bufferSize||0)>2||(connection.dataChannel?.bufferedAmount||0)>MAX_BYTES*2))return false;
    try{connection.send(data);return true;}catch{return false;}
  }
  function send(data,to){
    if(net.role==='client')return write(hostConnection,data);
    if(net.role==='host'&&to)return write(connections.get(to),data);
    return broadcast(data);
  }
  function broadcast(data){let sent=false;if(net.role==='client')return write(hostConnection,data);for(const connection of connections.values())if(net.peers.has(connection.peer))sent=write(connection,data)||sent;return sent;}
  function getInviteURL(){if(!net.room)return '';const url=new URL(window.location.protocol==='file:'?PUBLISHED_URL:window.location.href);url.search='';url.hash='';url.searchParams.set('room',net.room);return url.href;}
  function roster(){return [{id:net.id,name:net.name},...Array.from(net.peers.values(),p=>({id:p.id,name:p.name}))];}
  function sendRoster(){broadcast({__outpost:'roster',players:roster()});}
  function applyRoster(players){
    if(!Array.isArray(players)||players.length>4)return;
    const listed=new Set();
    for(const p of players){if(!p||typeof p.id!=='string'||p.id.length>80||p.id===net.id)continue;listed.add(p.id);const name=cleanName(p.name),existing=net.peers.get(p.id);net.peers.set(p.id,{id:p.id,name,connection:p.id===net.room?hostConnection:null,lastSeen:Date.now()});if(!existing)emit('onPeerJoin',p.id,name);}
    for(const id of [...net.peers.keys()])if(!listed.has(id)){net.peers.delete(id);emit('onPeerLeave',id);}
  }
  function leave(){
    generation++;
    if(pending){const op=pending;pending=null;op.reject(new Error('Подключение отменено.'));}
    for(const t of timers)clearTimeout(t);timers.clear();if(heartbeat)clearInterval(heartbeat);heartbeat=null;
    const active=peer;peer=null;hostConnection=null;connections.clear();net.peers.clear();net.role='solo';net.id=null;net.room=null;
    try{active?.destroy();}catch{}
  }
  function fail(message,op){
    if(op&&op.generation!==generation)return;
    const wasConnected=!pending&&net.role!=='solo';
    if(pending){const operation=pending;pending=null;operation.reject(new Error(message));}
    leave();status(message);if(wasConnected)emit('onDisconnect',message);
  }
  function peerErrorMessage(error){
    if(error?.type==='peer-unavailable')return 'Комната не найдена. Проверь приглашение и попроси ведущего открыть игру.';
    if(error?.type==='browser-incompatible')return 'Браузер не поддерживает сетевой режим. Открой игру в Chrome или Edge.';
    if(error?.type==='unavailable-id')return 'Код комнаты уже занят. Создай комнату ещё раз.';
    return 'Не удалось соединиться. Проверь интернет; если сеть блокирует WebRTC, попробуй другую сеть.';
  }
  function startOperation(role,name,room){
    leave();net.role=role;net.name=cleanName(name);net.room=room;const token=generation;
    return new Promise((resolve,reject)=>{
      const op={resolve,reject,generation:token};pending=op;
      if(typeof window.Peer!=='function'){fail('Сетевой модуль не загрузился. Обнови страницу с подключённым интернетом.',op);return;}
      // Relayed connections take longer to negotiate than direct ones.
      const timeout=timer(()=>fail('Соединение не установлено за 30 секунд. Ведущий должен держать игру открытой; попробуйте другую сеть, если WebRTC заблокирован.',op),30000);
      function ready(){if(token!==generation||pending!==op)return;clearTimer(timeout);pending=null;startHeartbeat(token);status(role==='host'?'Комната открыта. Пригласи друзей.':'Подключено. Ждём ведущего.');resolve(net);}
      loadIceServers().then(ice=>{
      if(token!==generation||pending!==op)return;
      if(FORCE_RELAY&&!ice.turn){fail('Режим relay=1 требует TURN-сервер, но он не настроен или недоступен.',op);return;}
      const config={iceServers:ice.servers};
      if(FORCE_RELAY)config.iceTransportPolicy='relay';
      try{peer=new window.Peer(role==='host'?room:'outpost-player-'+randomId(),{secure:true,debug:0,config});}catch(error){fail(peerErrorMessage(error),op);return;}
      peer.on('open',id=>{
        if(token!==generation)return;
        // Reconnecting to signalling must not open a second game channel.
        if(net.id&&pending!==op){status('Связь с поиском комнат восстановлена.');return;}
        net.id=id;
        if(role==='host')ready();
        // PeerJS JSON channels reject messages at 16,300 bytes. Binary channels
        // chunk larger snapshots so crowded waves cannot disconnect the room.
        else {status('Ведущий найден. Устанавливаем прямое соединение…');const conn=peer.connect(room,{serialization:'binary',reliable:true,metadata:{version:VERSION,name:net.name}});hostConnection=conn;attach(conn,token,ready);}
      });
      peer.on('connection',conn=>{if(token!==generation){conn.close();return;}if(role!=='host'){conn.close();return;}attach(conn,token);});
      peer.on('error',error=>{if(token!==generation)return;if(pending||error?.type==='browser-incompatible'||error?.type==='invalid-key')fail(peerErrorMessage(error),op);else status(peerErrorMessage(error));});
      peer.on('close',()=>{if(token===generation)fail('Сетевое соединение закрыто. Создай комнату или подключись заново.',op);});
      peer.on('disconnected',()=>{if(token!==generation)return;status('Связь с поиском комнат потеряна. Текущий бой продолжается.');timer(()=>{if(token===generation&&peer?.disconnected&&!peer.destroyed){try{peer.reconnect();}catch{}}},1500);});
      });
    });
  }
  async function host(name){const room='outpost-'+randomId();status('Создаём комнату…');return startOperation('host',name,room);}
  async function join(room,name){room=parseRoom(room);status('Ищем комнату…');return startOperation('client',name,room);}
  function attach(conn,token,ready){
    let accepted=false,lastSeen=Date.now();const isHost=net.role==='host';
    if(isHost){
      if(connections.size>=MAX_GUESTS||connections.has(conn.peer)){conn.on('open',()=>{write(conn,{__outpost:'reject',message:'Комната заполнена: максимум 4 игрока.'});timer(()=>conn.close(),150);});return;}
      connections.set(conn.peer,conn);
    }
    const helloTimeout=timer(()=>{if(!accepted){if(isHost){connections.delete(conn.peer);conn.close();}else fail('Ведущий не подтвердил соединение. Попробуй подключиться заново.');}},15000);
    conn.on('open',()=>{if(token!==generation){conn.close();return;}if(!isHost)write(conn,{__outpost:'hello',version:VERSION,name:net.name});});
    conn.on('data',data=>{
      if(token!==generation||!data||typeof data!=='object'||!packetFits(data))return;lastSeen=Date.now();conn._outpostLastSeen=lastSeen;
      if(data.__outpost==='reject'&&!isHost){fail(String(data.message||'Ведущий отклонил соединение.').slice(0,160));return;}
      if(data.__outpost==='hello'&&isHost&&!accepted){
        if(data.version!==VERSION){write(conn,{__outpost:'reject',message:'Версии игры различаются. Обновите страницу у всех игроков.'});timer(()=>conn.close(),100);return;}
        accepted=true;clearTimer(helloTimeout);const name=cleanName(data.name);net.peers.set(conn.peer,{id:conn.peer,name,connection:conn,lastSeen});
        write(conn,{__outpost:'welcome',version:VERSION,room:net.room,players:roster()});emit('onPeerJoin',conn.peer,name);sendRoster();return;
      }
      if(data.__outpost==='welcome'&&!isHost&&!accepted){
        if(data.version!==VERSION||data.room!==net.room){fail('Версия комнаты не совпадает. Обнови игру.');return;}
        accepted=true;clearTimer(helloTimeout);applyRoster(data.players);ready();return;
      }
      if(!accepted)return;
      if(data.__outpost==='ping'){write(conn,{__outpost:'pong'});return;}
      if(data.__outpost==='pong')return;
      if(data.__outpost==='roster'&&!isHost){applyRoster(data.players);return;}
      if(data.__outpost)return;
      emit('onData',data,conn.peer);
    });
    conn.on('close',()=>{
      clearTimer(helloTimeout);if(token!==generation)return;
      if(isHost){connections.delete(conn.peer);if(net.peers.delete(conn.peer)){emit('onPeerLeave',conn.peer);sendRoster();}}
      else fail('Ведущий отключился. Комната закрыта — создайте новую игру.');
    });
    conn.on('error',()=>{if(token!==generation)return;if(!isHost)fail('Связь с ведущим прервалась. Подключись заново.');else conn.close();});
  }
  function startHeartbeat(token){heartbeat=setInterval(()=>{
    if(token!==generation)return;const now=Date.now();const list=net.role==='host'?[...connections.values()]:[hostConnection];
    for(const conn of list){if(!conn?.open)continue;if(conn._outpostLastSeen&&now-conn._outpostLastSeen>25000){conn.close();continue;}write(conn,{__outpost:'ping'});}
  },2500);}
  return net;
}
