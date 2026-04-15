/* global chrome */

/**
 * Generate a unique installation key
 * Used to identify this specific extension installation
 */
function generateInstallationKey() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `install_${timestamp}_${randomPart}`;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // Generate and store unique installation key
    const installationKey = generateInstallationKey();
    chrome.storage.sync.set({ 
        installationKey: installationKey,
        lastAnnouncement: new Date().toISOString()
    }, () => {
      console.log('Installation key generated:', installationKey);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "open_options_page") {
    chrome.tabs.create({
      url: "settings_files/options.html"
    });
    return;
  }

  if (message.action === 'openrouter_generate') {
    const apiKey = (message.apiKey || '').trim();
    const prompt = message.prompt || '';
    const model = message.model || 'google/gemini-3-flash-preview';

    if (!apiKey) {
      sendResponse({ ok: false, status: 400, error: 'Hiányzó OpenRouter API token' });
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Title': 'TeKaKu Autofill Extension'
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    })
      .then(async (response) => {
        clearTimeout(timeoutId);
        const text = await response.text();
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }

        if (!response.ok) {
          sendResponse({
            ok: false,
            status: response.status,
            error: parsed?.error?.message || parsed?.message || text || response.statusText
          });
          return;
        }

        sendResponse({ ok: true, data: parsed });
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        sendResponse({ ok: false, status: 0, error: error?.message || String(error) });
      });

    return true;
  }
});