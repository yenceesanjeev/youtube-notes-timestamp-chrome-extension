document.addEventListener('DOMContentLoaded', async () => {
    const notesList = document.getElementById('notes-list');
    const noteInput = document.getElementById('note-input');
    const addNoteBtn = document.getElementById('add-note-btn');

    let currentVideoId = null;
    let noteStartTime = null;

    // Helper to get the current tab
    async function getCurrentTab() {
        const queryOptions = { active: true, lastFocusedWindow: true };
        // Try lastFocusedWindow first, fallback to currentWindow if needed
        let [tab] = await chrome.tabs.query(queryOptions);
        if (!tab) {
            [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        }
        return tab;
    }

    // Helper to extract video ID from URL
    function getVideoId(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('v');
        } catch (e) {
            return null;
        }
    }

    // Format time in MM:SS
    function formatTime(seconds) {
        const date = new Date(0);
        date.setSeconds(seconds);
        const result = date.toISOString().substr(11, 8);
        return result.startsWith('00:') ? result.substr(3) : result;
    }

    // Load notes for the current video
    async function loadNotes() {
        const tab = await getCurrentTab();
        if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
            notesList.innerHTML = '<div class="empty-state">Please open a YouTube video to take notes.</div>';
            addNoteBtn.disabled = true;
            return;
        }

        currentVideoId = getVideoId(tab.url);
        if (!currentVideoId) {
            notesList.innerHTML = '<div class="empty-state">Could not determine video ID.</div>';
            addNoteBtn.disabled = true;
            return;
        }

        addNoteBtn.disabled = false;

        const storage = await chrome.storage.local.get(currentVideoId);
        const notes = storage[currentVideoId] || [];
        renderNotes(notes);
    }

    // Delete note
    async function deleteNote(index) {
        const storage = await chrome.storage.local.get(currentVideoId);
        let notes = storage[currentVideoId] || [];

        notes.splice(index, 1);
        await chrome.storage.local.set({ [currentVideoId]: notes });
        renderNotes(notes);
    }

    // Render notes to the UI
    function renderNotes(notes) {
        notesList.innerHTML = '';
        if (notes.length === 0) {
            notesList.innerHTML = '<div class="empty-state">No notes yet for this video.</div>';
            return;
        }

        notes.forEach((note, index) => {
            const noteItem = document.createElement('div');
            noteItem.className = 'note-item';

            const header = document.createElement('div');
            header.className = 'note-header';

            const timestamp = document.createElement('a');
            timestamp.className = 'note-timestamp';
            timestamp.textContent = formatTime(note.time);
            timestamp.href = `https://www.youtube.com/watch?v=${currentVideoId}&t=${Math.floor(note.time)}s`;
            timestamp.target = "_blank"; // Good practice for external links, though we prevent default mostly

            timestamp.onclick = (e) => {
                e.preventDefault();
                seekTo(note.time);
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '&times;'; // Multiplication sign as X
            deleteBtn.title = 'Delete note';
            deleteBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent triggering other clicks if any
                if (confirm('Are you sure you want to delete this note?')) {
                    deleteNote(index);
                }
            };

            header.appendChild(timestamp);
            header.appendChild(deleteBtn);

            const text = document.createElement('div');
            text.className = 'note-text';
            text.textContent = note.text;

            noteItem.appendChild(header);
            noteItem.appendChild(text);
            notesList.appendChild(noteItem);
        });
    }

    // Seek video to specific time
    async function seekTo(time) {
        const tab = await getCurrentTab();
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'SEEK_TO', time: time }).catch(err => {
                console.error("Seek failed", err);
                // Optional: Try to inject if seek fails too, but usually addNote handles the injection first
            });
        }
    }

    // Add new note function
    async function addNote() {
        const text = noteInput.value.trim();
        if (!text) return;

        const tab = await getCurrentTab();
        if (!tab || !tab.id) {
            alert('No active tab found.');
            return;
        }

        try {
            let timeToSave;

            // Use captured start time if available, otherwise get current time
            if (noteStartTime !== null) {
                timeToSave = noteStartTime;
            } else {
                // Fallback if they didn't type (e.g. paste) or something went wrong
                let response;
                try {
                    response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_TIME' });
                } catch (e) {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                    response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_TIME' });
                }
                if (response && response.currentTime !== undefined) {
                    timeToSave = response.currentTime;
                }
            }

            if (timeToSave !== undefined) {
                const newNote = {
                    text: text,
                    time: timeToSave,
                    createdAt: Date.now()
                };

                const storage = await chrome.storage.local.get(currentVideoId);
                const notes = storage[currentVideoId] || [];
                notes.push(newNote);

                // Sort notes by time
                notes.sort((a, b) => a.time - b.time);

                await chrome.storage.local.set({ [currentVideoId]: notes });

                noteInput.value = '';
                noteStartTime = null; // Reset
                renderNotes(notes);
            }
        } catch (error) {
            console.error('Error adding note:', error);
            alert('Please refresh the YouTube page to enable the extension.');
        }
    }

    // Capture time when user starts typing
    noteInput.addEventListener('input', async () => {
        const text = noteInput.value.trim();

        // If user cleared the input, reset time
        if (text.length === 0) {
            noteStartTime = null;
            return;
        }

        // If this is the first character (or we haven't captured time yet)
        if (noteStartTime === null) {
            const tab = await getCurrentTab();
            if (tab && tab.id) {
                try {
                    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_TIME' });
                    if (response && response.currentTime !== undefined) {
                        // Capture time 5 seconds before
                        noteStartTime = Math.max(0, response.currentTime - 5);
                    }
                } catch (e) {
                    console.log("Could not capture start time on input", e);
                }
            }
        }
    });

    // Handle Enter key to submit, Cmd/Ctrl+Enter for new line
    noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.metaKey || e.ctrlKey) {
                // Allow default behavior (new line)
                return;
            }
            // Prevent default (new line) and add note
            e.preventDefault();
            addNote();
        }
    });

    // Add new note button click
    addNoteBtn.addEventListener('click', addNote);

    // Copy notes to clipboard
    const copyBtn = document.getElementById('copy-notes-btn');
    copyBtn.addEventListener('click', async () => {
        if (!currentVideoId) return;

        const storage = await chrome.storage.local.get(currentVideoId);
        const notes = storage[currentVideoId] || [];

        if (notes.length === 0) {
            return;
        }

        const tab = await getCurrentTab();
        const videoTitle = tab ? tab.title.replace(' - YouTube', '') : 'YouTube Video';

        // Create plain text version
        const textContent = `${videoTitle}\n\n` + notes.map(note => `${formatTime(note.time)} - ${note.text}`).join('\n');

        // Create HTML version with links
        const htmlContent = `<h3>${videoTitle}</h3>` + notes.map(note => {
            const time = formatTime(note.time);
            const url = `https://www.youtube.com/watch?v=${currentVideoId}&t=${Math.floor(note.time)}s`;
            return `<div><a href="${url}">${time}</a> - ${note.text}</div>`;
        }).join('');

        try {
            // Try using the Clipboard API for rich text
            if (typeof ClipboardItem !== 'undefined') {
                const blobHtml = new Blob([htmlContent], { type: 'text/html' });
                const blobText = new Blob([textContent], { type: 'text/plain' });
                const data = [new ClipboardItem({
                    'text/html': blobHtml,
                    'text/plain': blobText
                })];
                await navigator.clipboard.write(data);
            } else {
                // Fallback for browsers not supporting ClipboardItem (unlikely in modern Chrome but good safety)
                await navigator.clipboard.writeText(textContent);
            }

            // Visual feedback
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
            // Fallback to plain text if rich copy fails
            try {
                await navigator.clipboard.writeText(textContent);
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied (Text)!';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
            } catch (e) {
                console.error('Fallback failed', e);
            }
        }
    });

    // Initial load
    loadNotes();

    // Reload notes if tab updates (e.g. navigation to new video)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.active) {
            loadNotes();
        }
    });
});
