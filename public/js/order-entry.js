/* Order Entry — dynamic form that sends new orders over WebSocket. */

const { Socket, toast } = window.RestaurantOps;
const socket = new Socket();

const itemsEl     = document.getElementById('items');
const addBtn      = document.getElementById('addItem');
const form        = document.getElementById('orderForm');
const channelSel  = document.getElementById('channel');
const tableField  = document.getElementById('tableField');
const custField   = document.getElementById('customerField');
const sampleBtn   = document.getElementById('sampleBtn');

// A pool of realistic-looking sample items so the form is easy to demo.
const SAMPLES = [
  { name: 'Al pastor tacos (3)', prepTimeMinutes: 8 },
  { name: 'Carne asada burrito', prepTimeMinutes: 10 },
  { name: 'Chicken quesadilla',  prepTimeMinutes: 7 },
  { name: 'Elote',               prepTimeMinutes: 4 },
  { name: 'Horchata',            prepTimeMinutes: 2 },
  { name: 'Birria ramen',        prepTimeMinutes: 12 },
  { name: 'Guac & chips',        prepTimeMinutes: 3 },
  { name: 'Shrimp ceviche',      prepTimeMinutes: 9 },
];

function itemRow(initial = {}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <div>
      <label>Item</label>
      <input class="name" placeholder="e.g. Al pastor tacos" value="${initial.name || ''}" required />
    </div>
    <div>
      <label>Qty</label>
      <input class="qty" type="number" min="1" value="${initial.quantity || 1}" required />
    </div>
    <div>
      <label>Prep (min)</label>
      <input class="prep" type="number" min="1" value="${initial.prepTimeMinutes || 6}" required />
    </div>
    <button type="button" class="remove-item" title="Remove">✕</button>
  `;
  row.querySelector('.remove-item').addEventListener('click', () => {
    if (itemsEl.children.length > 1) row.remove();
    else toast('An order needs at least one item.', { error: true });
  });
  return row;
}

function addItem(initial) {
  itemsEl.appendChild(itemRow(initial));
}

addItem();
addBtn.addEventListener('click', () => addItem());

// Swap "Table #" vs "Customer name" based on channel.
function updateChannelFields() {
  const ch = channelSel.value;
  if (ch === 'dine-in') {
    tableField.style.display = '';
    custField.style.display  = 'none';
  } else {
    tableField.style.display = 'none';
    custField.style.display  = '';
  }
}
channelSel.addEventListener('change', updateChannelFields);
updateChannelFields();

sampleBtn.addEventListener('click', () => {
  const channels = ['dine-in', 'online', 'takeaway'];
  channelSel.value = channels[Math.floor(Math.random() * channels.length)];
  updateChannelFields();
  if (channelSel.value === 'dine-in') {
    document.getElementById('tableNumber').value = String(Math.floor(Math.random() * 20) + 1);
  } else {
    const names = ['Maria G.', 'Jamal K.', 'Priya S.', 'Alex R.', 'Chen L.', 'Omar R.'];
    document.getElementById('customerName').value = names[Math.floor(Math.random() * names.length)];
  }
  itemsEl.innerHTML = '';
  const picks = [...SAMPLES].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
  picks.forEach((p) => addItem({ ...p, quantity: 1 + Math.floor(Math.random() * 2) }));
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const rows = [...itemsEl.querySelectorAll('.item-row')];
  const items = rows.map((r) => ({
    name:            r.querySelector('.name').value.trim(),
    quantity:        parseInt(r.querySelector('.qty').value, 10),
    prepTimeMinutes: parseInt(r.querySelector('.prep').value, 10),
  })).filter((it) => it.name);

  if (items.length === 0) {
    toast('Add at least one item.', { error: true });
    return;
  }

  const payload = {
    channel:      channelSel.value,
    tableNumber:  document.getElementById('tableNumber').value.trim() || null,
    customerName: document.getElementById('customerName').value.trim() || null,
    items,
    notes:        document.getElementById('notes').value.trim(),
  };

  socket.send({ type: 'create_order', payload });
  toast('Order sent to the kitchen.');
  form.reset();
  itemsEl.innerHTML = '';
  addItem();
  updateChannelFields();
});

socket.on('serverError', (msg) => toast(msg, { error: true }));
