(() => {
  const cfg = window.NMAMIT_CONFIG || {};
  const $ = id => document.getElementById(id);
  let sb = null, items = [], display = null, busy = false;
  const validConfig = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const say = message => $('notice').textContent = message;
  const setConnected = ok => { $('connection').textContent = ok ? 'CONNECTED' : 'OFFLINE'; $('connection').style.color = ok ? 'var(--accent)' : 'var(--danger)'; };
  const headers = () => ({apikey:cfg.SUPABASE_ANON_KEY, Authorization:`Bearer ${cfg.SUPABASE_ANON_KEY}`, 'Content-Type':'application/json'});
  async function request(path, options={}) {
    const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, { ...options, headers:{...headers(), ...(options.headers||{})} });
    if (!r.ok) throw new Error((await r.text()).slice(0,180));
    return r.status === 204 ? null : r.json();
  }
  async function load() {
    if (!validConfig) { setConnected(false); say('Setup required: edit controller/config.js with your Supabase project details.'); return; }
    try {
      const rows = await request(`displays?id=eq.${encodeURIComponent(cfg.DISPLAY_ID)}&select=id,name,is_active,playback_state,loop_mode,current_index`);
      display = rows && rows[0];
      if (!display) throw new Error('Display not found. Check DISPLAY_ID and run schema.sql.');
      $('displayName').textContent = display.name;
      const data = await request(`playlist_items?display_id=eq.${encodeURIComponent(cfg.DISPLAY_ID)}&select=*&order=position.asc,created_at.asc`);
      items = data || [];
      setConnected(true); render();
      say('Connected. Playlist is read-only until a secure upload/control endpoint is configured.');
    } catch (e) { setConnected(false); say(`Connection issue: ${e.message}`); }
  }
  function render() {
    $('itemCount').textContent = items.length;
    const active = items[Math.min(Number(display?.current_index||0), Math.max(0,items.length-1))];
    $('nowTitle').textContent = active ? active.title : 'Waiting for playlist';
    $('nowType').textContent = active ? active.media_type.toUpperCase() : 'READY';
    $('playBtn').textContent = display?.playback_state === 'paused' ? '▶' : 'Ⅱ';
    $('loopMode').value = display?.loop_mode || 'playlist';
    const list = $('playlist'); list.innerHTML = '';
    if (!items.length) { list.className='playlist empty'; list.textContent='No media yet. Finish secure upload setup to add content.'; return; }
    list.className='playlist';
    items.forEach((it,i) => {
      const row=document.createElement('div'); row.className='item';
      const thumb=document.createElement(it.media_type==='image'?'img':'div'); thumb.className='thumb';
      if(it.media_type==='image'){thumb.src=it.media_url;thumb.alt='';} else {thumb.textContent='▶';thumb.style.display='grid';thumb.style.placeItems='center';}
      const info=document.createElement('div');info.className='item-info';
      const title=document.createElement('div');title.className='item-title';title.textContent=it.title;
      const sub=document.createElement('div');sub.className='item-sub';sub.textContent=`${it.media_type.toUpperCase()} · ${it.duration_seconds||10}s`;
      info.append(title,sub);
      const actions=document.createElement('div');actions.className='item-actions';
      const up=document.createElement('button');up.className='small-btn';up.textContent='↑';up.title='Move up';up.onclick=()=>say('Playlist editing requires the secure Edge Function endpoint described in SETUP.md.');
      const down=document.createElement('button');down.className='small-btn';down.textContent='↓';down.title='Move down';down.onclick=()=>say('Playlist editing requires the secure Edge Function endpoint described in SETUP.md.');
      const del=document.createElement('button');del.className='small-btn danger';del.textContent='×';del.title='Remove';del.onclick=()=>say('Removal requires the secure Edge Function endpoint described in SETUP.md.');
      actions.append(up,down,del);row.append(thumb,info,actions);list.append(row);
    });
  }
  async function uploadFiles(fileList) {
    if (!validConfig || !cfg.CONTROLLER_TOKEN || cfg.CONTROLLER_TOKEN.includes('CHANGE-THIS')) { say('Configure a real controller token and secure upload endpoint first.'); return; }
    say('Uploads are disabled in this starter until the secure Edge Function is deployed. See SETUP.md.');
    $('fileInput').value='';
  }
  $('fileInput').addEventListener('change',e=>uploadFiles(e.target.files));
  $('playBtn').onclick=()=>say('Playback control endpoint must be deployed before remote controls can change the player.');
  $('prevBtn').onclick=()=>say('Playback control endpoint must be deployed before remote controls can change the player.');
  $('nextBtn').onclick=()=>say('Playback control endpoint must be deployed before remote controls can change the player.');
  $('loopMode').onchange=()=>say('Playback control endpoint must be deployed before changing loop mode.');
  if (validConfig && window.supabase) { try { sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY); } catch(_){} }
  load();
  setInterval(load,8000);
})();
