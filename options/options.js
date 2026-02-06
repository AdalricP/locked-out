// Locked Out - Options Page Logic

// DOM elements
const elements = {
  apiKeyInput: document.getElementById('apiKeyInput'),
  toggleApiKeyBtn: document.getElementById('toggleApiKeyBtn'),
  testApiKeyBtn: document.getElementById('testApiKeyBtn'),
  apiStatus: document.getElementById('apiStatus'),
  saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
  blocklistInput: document.getElementById('blocklistInput'),
  blocklistCount: document.getElementById('blocklistCount'),
  saveBlocklistBtn: document.getElementById('saveBlocklistBtn'),
  superBlocklistInput: document.getElementById('superBlocklistInput'),
  superBlocklistCount: document.getElementById('superBlocklistCount'),
  saveSuperBlocklistBtn: document.getElementById('saveSuperBlocklistBtn')
};

// Initialize
async function init() {
  const result = await chrome.storage.local.get(['apiKey', 'blocklist', 'superBlocklist']);

  if (result.apiKey) elements.apiKeyInput.value = result.apiKey;
  if (result.blocklist) {
    elements.blocklistInput.value = result.blocklist.join('\n');
    updateBlocklistCount(result.blocklist);
  }
  if (result.superBlocklist) {
    elements.superBlocklistInput.value = result.superBlocklist.join('\n');
    updateSuperBlocklistCount(result.superBlocklist);
  }

  // Event listeners
  elements.saveApiKeyBtn.addEventListener('click', saveApiKey);
  elements.toggleApiKeyBtn.addEventListener('click', toggleApiKeyVisibility);
  elements.testApiKeyBtn.addEventListener('click', testApiKey);
  elements.saveBlocklistBtn.addEventListener('click', saveBlocklist);
  elements.saveSuperBlocklistBtn.addEventListener('click', saveSuperBlocklist);
}

async function saveApiKey() {
  const apiKey = elements.apiKeyInput.value.trim();
  await chrome.storage.local.set({ apiKey });
  showButtonSaved(elements.saveApiKeyBtn);
  hideApiStatus();
}

function toggleApiKeyVisibility() {
  const input = elements.apiKeyInput;
  const eyeOpen = elements.toggleApiKeyBtn.querySelector('.eye-open');
  const eyeClosed = elements.toggleApiKeyBtn.querySelector('.eye-closed');

  if (input.type === 'password') {
    input.type = 'text';
    eyeOpen.hidden = true;
    eyeClosed.hidden = false;
  } else {
    input.type = 'password';
    eyeOpen.hidden = false;
    eyeClosed.hidden = true;
  }
}

async function testApiKey() {
  const apiKey = elements.apiKeyInput.value.trim();

  if (!apiKey) {
    showApiStatus('Please enter an API key first', 'error');
    return;
  }

  elements.testApiKeyBtn.disabled = true;
  elements.testApiKeyBtn.textContent = 'Testing...';

  try {
    const isValid = await testOpenRouterApiKey(apiKey);

    if (isValid) {
      showApiStatus('API key is valid! Connection successful.', 'success');
    } else {
      showApiStatus('Invalid API key. Please check and try again.', 'error');
    }
  } catch (error) {
    showApiStatus(`Error testing API key: ${error.message}`, 'error');
  } finally {
    elements.testApiKeyBtn.disabled = false;
    elements.testApiKeyBtn.textContent = 'Test Connection';
  }
}

async function testOpenRouterApiKey(apiKey) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

function showApiStatus(message, type) {
  elements.apiStatus.textContent = message;
  elements.apiStatus.className = `status-message ${type}`;
  elements.apiStatus.hidden = false;
}

function hideApiStatus() {
  elements.apiStatus.hidden = true;
}

async function saveBlocklist() {
  const text = elements.blocklistInput.value;
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^https?:\/\//, '').replace(/^www\./, ''))
    .filter((line, index, self) => self.indexOf(line) === index);

  await chrome.storage.local.set({ blocklist: lines });
  updateBlocklistCount(lines);
  showButtonSaved(elements.saveBlocklistBtn);
}

async function saveSuperBlocklist() {
  const text = elements.superBlocklistInput.value;
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^https?:\/\//, '').replace(/^www\./, ''))
    .filter((line, index, self) => self.indexOf(line) === index);

  await chrome.storage.local.set({ superBlocklist: lines });
  updateSuperBlocklistCount(lines);
  showButtonSaved(elements.saveSuperBlocklistBtn);
}

function updateBlocklistCount(blocklist) {
  elements.blocklistCount.textContent = blocklist.length;
}

function updateSuperBlocklistCount(blocklist) {
  elements.superBlocklistCount.textContent = blocklist.length;
}

function showButtonSaved(button) {
  const btnText = button.querySelector('.btn-text');
  const btnSaved = button.querySelector('.btn-saved');

  btnText.hidden = true;
  btnSaved.hidden = false;

  setTimeout(() => {
    btnText.hidden = false;
    btnSaved.hidden = true;
  }, 2000);
}

// Start
init();
