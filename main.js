(async () => {
  const socket = io();

  // Get session info
  let session = await fetch('/api/session').then(r => r.json());
  let username = (session && session.username) ? session.username : ('Guest' + Math.floor(Math.random()*10000));
  document.getElementById('session-info').textContent = username;
  document.getElementById('logout').style.display = session.authenticated ? 'inline' : 'none';

  socket.emit('identify', { username });

  const messagesEl = document.getElementById('messages');

  function renderMessage(m) {
    const wrap = document.createElement('div');
    wrap.className = 'message';
    wrap.dataset.id = m.id;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const left = document.createElement('div');
    left.textContent = `${m.user}`;
    const right = document.createElement('div');
    const d = new Date(m.timestamp || Date.now());
    right.textContent = d.toLocaleString();
    meta.appendChild(left);
    meta.appendChild(right);

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = m.text;

    const reactions = document.createElement('div');
    reactions.className = 'reactions';
    (m.reactions || []).forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'react-btn';
      btn.textContent = `${r.reaction} · ${r.user}`;
      reactions.appendChild(btn);
    });

    // quick reaction buttons
    const quick = document.createElement('div');
    quick.style.marginTop = '6px';
    ['👍','❤️','😂','😮','👎'].forEach(sym => {
      const b = document.createElement('button');
      b.className = 'react-btn';
      b.textContent = sym;
      b.onclick = () => {
        socket.emit('react', { messageId: m.id, reaction: sym, user: username });
      };
      quick.appendChild(b);
    });

    wrap.appendChild(meta);
    wrap.appendChild(text);
    wrap.appendChild(reactions);
    wrap.appendChild(quick);

    return wrap;
  }

  async function loadHistory() {
    const resp = await fetch('/api/messages').then(r => r.json());
    messagesEl.innerHTML = '';
    resp.messages.forEach(m => messagesEl.appendChild(renderMessage(m)));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  loadHistory();

  // realtime updates
  socket.on('new_message', (m) => {
    messagesEl.appendChild(renderMessage(m));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  socket.on('new_reaction', (r) => {
    // find message element
    const msgEl = messagesEl.querySelector(`[data-id="${r.message_id}"]`);
    if (!msgEl) return;
    const reactionsDiv = msgEl.querySelector('.reactions');
    const btn = document.createElement('button');
    btn.className = 'react-btn';
    btn.textContent = `${r.reaction} · ${r.user}`;
    reactionsDiv.appendChild(btn);
  });

  // compose
  const form = document.getElementById('compose');
  const input = document.getElementById('messageInput');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    socket.emit('send_message', { text, user: username });
    input.value = '';
  });

})();