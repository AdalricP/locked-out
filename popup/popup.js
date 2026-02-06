// Locked Out - Chat Interface

const urlParams = new URLSearchParams(window.location.search);
const targetUrl = urlParams.get('url');
const pageTitleParam = urlParams.get('title');
const tabId = urlParams.get('tabId');

let targetHostname = '';
try {
  if (targetUrl) {
    targetHostname = new URL(targetUrl).hostname;
  }
} catch (e) {
  console.error('Invalid URL:', targetUrl);
}

let isWaiting = false;

// DOM elements (will be set after DOM loads)
let chatMessages, reasonInput, sendBtn;

// Cached system prompt template
let systemPromptTemplate = '';
let soulTemplate = '';

// Load system prompt from file
async function loadSystemPrompt() {
  try {
    // Load soul.md
    const soulResponse = await fetch(chrome.runtime.getURL('popup/soul.md'));
    if (soulResponse.ok) {
      soulTemplate = await soulResponse.text();
    }

    // Load system_prompt.md
    const response = await fetch(chrome.runtime.getURL('popup/system_prompt.md'));
    if (response.ok) {
      systemPromptTemplate = await response.text();
    } else {
      // Fallback if file not found
      systemPromptTemplate = `You are a strict focus assistant.

User's goal: "{{goal}}"
They want to visit: {{title}}
URL: {{url}}

Be skeptical. Require specific reasons. Deny vague explanations.

Respond ONLY with JSON: {"decision": "allow"|"deny", "message": "brief response"}`;
    }
  } catch (e) {
    console.error('Failed to load system prompt:', e);
    // Use fallback
    systemPromptTemplate = `You are a strict focus assistant.

User's goal: "{{goal}}"
They want to visit: {{title}}
URL: {{url}}

Be skeptical. Require specific reasons. Deny vague explanations.

Respond ONLY with JSON: {"decision": "allow"|"deny", "message": "brief response"}`;
  }
}

function buildSystemPrompt(url, title, timeSpent, searchResult) {
  // Build the full prompt with soul
  let fullPrompt = '';
  if (soulTemplate) {
    fullPrompt += soulTemplate + '\n\n';
  }
  fullPrompt += systemPromptTemplate;

  let prompt = fullPrompt
    .replace('{{fullUrl}}', url)
    .replace('{{timeSpent}}', timeSpent || '0s');

  // Add search result if available
  if (searchResult) {
    prompt = prompt.replace('{{searchResult}}', searchResult);
  } else {
    prompt = prompt.replace('{{searchResult}}', '(no search performed)');
  }

  return prompt;
}

// Fetch time spent on this domain
async function getTimeSpent() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getTimeSpent',
      hostname: targetHostname
    });
    return response?.timeSpent || '0s';
  } catch (e) {
    return '0s';
  }
}

// Search DuckDuckGo to fact-check claims
async function duckDuckGoSearch(query) {
  try {
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
    if (!response.ok) return null;

    const data = await response.json();
    // Extract the abstract/answer from the first result
    if (data.AbstractText || data.AbstractURL || data.Heading) {
      let result = data.Heading || '';
      if (data.AbstractText) {
        result += ': ' + data.AbstractText.substring(0, 200);
      }
      return result;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function init() {
  // Clear the tab title immediately
  document.title = '';

  // Get DOM elements
  chatMessages = document.getElementById('chatMessages');
  reasonInput = document.getElementById('reasonInput');
  sendBtn = document.getElementById('sendBtn');

  if (!chatMessages || !reasonInput || !sendBtn) {
    console.error('Required DOM elements not found');
    return;
  }

  if (!targetUrl) {
    addMessage('Error: No target URL specified.', 'system');
    return;
  }

  // Load system prompt template
  await loadSystemPrompt();

  chrome.storage.local.get(['apiKey'], (result) => {
    if (!result.apiKey) {
      addMessage('Please configure your API key in settings first.', 'system');
      return;
    }

    sendBtn.addEventListener('click', handleSubmit);
    reasonInput.addEventListener('input', updateSendButton);
    reasonInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled && !isWaiting) handleSubmit();
      }
    });

    reasonInput.focus();
  });
}

function updateSendButton() {
  if (sendBtn && reasonInput) {
    sendBtn.disabled = reasonInput.value.trim().length === 0 || isWaiting;
  }
}

function addMessage(text, type) {
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${type}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = text;

  msgDiv.appendChild(contentDiv);
  chatMessages.appendChild(msgDiv);

  chatMessages.scrollTop = chatMessages.scrollHeight;

  return contentDiv;
}

function showTyping() {
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message system';
  msgDiv.id = 'typingIndicator';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'typing-indicator';
  contentDiv.innerHTML = '<span></span><span></span><span></span>';

  msgDiv.appendChild(contentDiv);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return msgDiv;
}

function hideTyping() {
  const typing = document.getElementById('typingIndicator');
  if (typing) typing.remove();
}

async function handleSubmit() {
  const reason = reasonInput?.value.trim();
  if (!reason || isWaiting) return;

  addMessage(reason, 'user');
  reasonInput.value = '';
  updateSendButton();

  isWaiting = true;
  updateSendButton();

  showTyping();

  try {
    const result = await chrome.storage.local.get(['apiKey']);
    const { apiKey } = result;

    const decision = await evaluateWithOpenRouter(apiKey, targetUrl, pageTitleParam || targetUrl, reason);

    hideTyping();

    if (decision.decision === 'allow') {
      addMessage(decision.message || 'Alright, you can go through.', 'system');

      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'allowSite',
          hostname: targetHostname,
          duration: 0,
          url: targetUrl
        });
      }, 1500);
    } else {
      addMessage(decision.message || 'Not convinced. Try again with more specifics.', 'system');
    }

  } catch (error) {
    hideTyping();
    addMessage(`Error: ${error.message || 'Something went wrong. Try again.'}`, 'system');
  } finally {
    isWaiting = false;
    updateSendButton();
    reasonInput?.focus();
  }
}

async function evaluateWithOpenRouter(apiKey, url, title, reason) {
  const messages = [];

  // Get conversation history for context
  const historyElements = chatMessages?.querySelectorAll('.message');
  if (historyElements) {
    const history = Array.from(historyElements)
      .map(msg => {
        const isUser = msg.classList.contains('user');
        const text = msg.querySelector('.message-content')?.textContent || '';
        return { role: isUser ? 'user' : 'assistant', content: text };
      });
    messages.push(...history.slice(-4)); // Last 4 messages
  }

  const timeSpent = await getTimeSpent();

  // DuckDuckGo fact-check for specific claims
  let searchResult = null;
  const hasSpecificClaims = /[A-Z][a-z]+\.?[A-Z][a-z]+|[A-Z][a-z]+ \d+|lecture|video|post|article|paper|course|series|tweet/i.test(reason);
  if (hasSpecificClaims) {
    // Extract potential search terms
    const searchTerms = reason.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g) || [reason];
    const searchQuery = [...searchTerms, targetHostname].join(' ');
    searchResult = await duckDuckGoSearch(searchQuery);
  }

  const systemPrompt = buildSystemPrompt(url, pageTitleParam || url, timeSpent, searchResult);

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://locked-out.local',
      'X-Title': 'Locked Out'
    },
    body: JSON.stringify({
      model: 'arcee-ai/trinity-large-preview:free',
      messages: allMessages,
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || error.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Invalid response from AI');
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
