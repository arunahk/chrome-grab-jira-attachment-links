// Parse the HTML document and find Jira URL and the current ticket ID
// Server Jira not supported

function create_element(filename, url) {
  const row = document.createElement('tr');
  row.setAttribute('data-link', url);
  row.setAttribute('data-filename', filename);

  // Add actions column
  const tdActions = document.createElement('td');

  // Function to create buttons
  const createButton = (className, text) => {
    const button = document.createElement('button');
    button.className = className;
    button.setAttribute('type', 'button');
    button.textContent = text;
    button.setAttribute('data-link', url); // Add data-link to button
    button.setAttribute('data-filename', filename); // Add data-filename to button
    return button;
  };

  // Existing Copy URL button
  const button = createButton('copy-url-btn', 'Copy URL');

  // Existing Copy MD button
  const buttonMd = createButton('copy-md-btn', 'Copy MD');

  // New Insert button
  const buttonInsert = createButton('insert-md', 'Insert');

  tdActions.appendChild(button);
  tdActions.appendChild(buttonMd);
  tdActions.appendChild(buttonInsert);

  // Add filename column
  const tdFilename = document.createElement('td');
  tdFilename.textContent = filename;

  // Append both columns
  row.appendChild(tdActions);
  row.appendChild(tdFilename);

  return row;
}

function grab_jira_ticket() {
  // This function runs in the context of the page
  // Try to extract the Jira base URL and issue key from the page
  const url = window.location.origin;
  // Try to match the issue key from the URL (e.g., /browse/PROJ-123)
  const regex = /\/browse\/([A-Z][A-Z0-9]+-\d+)/;
  const match = regex.exec(window.location.pathname);
  if (match) {
    return { url, key: match[1] };
  }
  return {};
}

async function run_query(url, key) {
  // Query Jira REST API for issue details
  const apiUrl = `${url}/rest/api/2/issue/${key}?fields=attachment`;
  const response = await fetch(apiUrl, { credentials: "include" });
  if (!response.ok) throw new Error("Jira API error");
  return await response.text();
}

function parse_json(response) {
  try {
    return JSON.parse(response);
  } catch (e) {
    console.error("Error parsing JSON:", e);
    return null;
  }
}

function lookup_attachments(json) {
  if (
    json?.fields &&
    Array.isArray(json.fields.attachment)
  ) {
    // Add created timestamp as number for sorting
    return json.fields.attachment.map(a => ({
      ...a,
      created: new Date(a.created).getTime()
    }));
  }
  return [];
}

async function insertTextAtCursor(text) {
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Inject script to insert text
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => {
        const activeElement = document.activeElement;
        if (activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable
          || (activeElement.tagName === 'INPUT' && activeElement.type === 'text')) {
          const startPos = activeElement.selectionStart;
          const endPos = activeElement.selectionEnd;
          const before = activeElement.value.substring(0, startPos);
          const after = activeElement.value.substring(endPos);
          activeElement.value = before + text + after;
          activeElement.selectionStart = activeElement.selectionEnd = startPos + text.length;
        }
      },
      args: [text]
    });
  } catch (err) {
    console.error('Failed to insert text:', err);
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('insert-md')) {
    e.preventDefault(); // Prevent default button behavior
    const link = e.target.getAttribute('data-link');
    const filename = e.target.getAttribute('data-filename');
    const mdLink = `[${filename}](${link})`;

    // Store the currently focused element
    const activeElement = document.activeElement;

    await insertTextAtCursor(mdLink);

    // Restore focus to the stored element
    if (activeElement) {
      activeElement.focus();
    }
  }
  if (e.target?.classList.contains('copy-url-btn')) {
    await copyToClipboard(e.target, "data-link", BUTTON_STATES.URL);
  } else if (e.target?.classList.contains('copy-md-btn')) {
    await copyToClipboard(e.target, "data-filename", BUTTON_STATES.MD);
  }
});

async function copyToClipboard(target, type, buttonStates) {
  let text = "";
  if (type === "data-link") {
    text = target.getAttribute("data-link");
  } else {
    const link = target.getAttribute("data-link");
    const filename = target.getAttribute("data-filename");
    text = `[${filename}](${link})`;
  }
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      target.textContent = buttonStates.success;
      setTimeout(() => { target.textContent = buttonStates.default; }, COPY_TIMEOUT_MS);
    } catch (err) {
      console.error("Error copying to clipboard:", err);
      target.textContent = buttonStates.error;
      setTimeout(() => { target.textContent = buttonStates.default; }, COPY_TIMEOUT_MS);
    }
  }
}

const COPY_TIMEOUT_MS = 1500;
const BUTTON_STATES = {
  URL: { default: 'Copy URL', success: 'Copied', error: 'Failed' },
  MD: { default: 'Copy MD', success: 'Copied', error: 'Failed' }
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.results-container')) {
    document.querySelector('.results-container').addEventListener('click', async (e) => {
      const copyButton = e.target;

      const resetButton = (button, defaultText) => {
        setTimeout(() => { button.textContent = defaultText; }, COPY_TIMEOUT_MS);
      };

      const handleCopy = async (text, button, defaultText) => {
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = BUTTON_STATES.URL.success;
          resetButton(button, defaultText);
        } catch (err) {
          console.error("Error copying to clipboard:", err);
          button.textContent = BUTTON_STATES.URL.error;
          resetButton(button, defaultText);
        }
      };

      if (copyButton?.classList.contains('copy-url')) {
        const link = copyButton.getAttribute("data-link");
        if (link) {
          await handleCopy(link, copyButton, BUTTON_STATES.URL.default);
        }
      }

      if (copyButton?.classList.contains('copy-md')) {
        const link = copyButton.getAttribute("data-link");
        const filename = copyButton.getAttribute("data-filename");
        if (link && filename) {
          // Removed unused markdown variable
          await handleCopy(markdown, copyButton, BUTTON_STATES.MD.default);
        }
      }
    });
  }
});

window.addEventListener('load', async () => {
  const div = document.getElementById("attachments");
  if (!div) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const injectionResult = await injectScript(tab, div);
  if (!injectionResult) return;

  const { key, url } = extractJiraDetails(injectionResult, div);
  if (!key || !url) return;

  const response = await fetchJiraData(url, key, div);
  if (!response) return;

  const attachmentList = processAttachments(response, div);
  if (!attachmentList) return;

  renderAttachments(div, attachmentList);
});

async function injectScript(tab, div) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: grab_jira_ticket
    });
    return result?.[0]?.result;
  } catch (e) {
    console.error("Error during script injection:", e);
    div.textContent = "Failed to inject script. Please ensure the extension has the necessary permissions.";
    return null;
  }
}

function extractJiraDetails(result, div) {
  if (!result || !Object.keys(result).length) {
    div.textContent = "Not in Jira or Jira URL or ticket key not found.";
    return {};
  }
  return { key: result.key, url: result.url };
}

async function fetchJiraData(url, key, div) {
  try {
    return await run_query(url, key);
  } catch (e) {
    console.error("Error fetching Jira data:", e);
    div.textContent = "Failed to fetch Jira data. Please check your network connection or Jira permissions.";
    return null;
  }
}

function processAttachments(response, div) {
  const json = parse_json(response);
  if (!json) {
    div.textContent = "Failed to parse JSON.";
    return null;
  }

  const attachments = lookup_attachments(json);
  if (!attachments.length) {
    div.textContent = "No attachments found.";
    return null;
  }

  return attachments.sort((a, b) => b.created - a.created);
}

function renderAttachments(div, attachmentList) {
  div.innerHTML = "";
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Actions', 'Filename'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  attachmentList.forEach(attachment => {
    tbody.appendChild(create_element(attachment.filename, attachment.content));
  });
  table.appendChild(tbody);
  div.appendChild(table);

  const newDiv = div.cloneNode(true);
  div.parentNode.replaceChild(newDiv, div);
  newDiv.addEventListener("click", handleAttachmentClick);
}

async function handleAttachmentClick(e) {
  if (e.target?.classList.contains('copy-url')) {
    await copyToClipboard(e.target, "data-link", BUTTON_STATES.URL);
  } else if (e.target?.classList.contains('copy-md')) {
    const link = e.target.getAttribute("data-link");
    const filename = e.target.getAttribute("data-filename");
    if (link && filename) {
      await copyToClipboard(e.target, "data-filename", BUTTON_STATES.MD);
    }
  }
}