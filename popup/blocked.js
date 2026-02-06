// Locked Out - Blocked Page Script

document.getElementById('settingsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
});

document.title = 'blocked';
