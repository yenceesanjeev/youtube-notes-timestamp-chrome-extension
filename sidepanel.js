document.addEventListener('DOMContentLoaded', async () => {
    const notesList = document.getElementById('notes-list');
    const noteInput = document.getElementById('note-input');
    const addNoteBtn = document.getElementById('add-note-btn');

    let currentVideoId = null;

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

            const timestamp = document.createElement('div');
            timestamp.className = 'note-timestamp';
            timestamp.textContent = formatTime(note.time);
            timestamp.onclick = () => seekTo(note.time);

            const text = document.createElement('div');
            text.className = 'note-text';
            text.textContent = note.text;

            noteItem.appendChild(timestamp);
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
            let response;
            try {
                response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_TIME' });
            } catch (e) {
                // If message fails, content script might not be loaded (e.g. after extension reload)
                // Try to inject it dynamically
                console.log("Initial message failed, attempting injection...", e);
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                // Retry sending message
                response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_TIME' });
            }

            if (response && response.currentTime !== undefined) {
                const newNote = {
                    text: text,
                    time: response.currentTime,
                    createdAt: Date.now()
                };

                const storage = await chrome.storage.local.get(currentVideoId);
                const notes = storage[currentVideoId] || [];
                notes.push(newNote);

                // Sort notes by time
                notes.sort((a, b) => a.time - b.time);

                await chrome.storage.local.set({ [currentVideoId]: notes });

                noteInput.value = '';
                renderNotes(notes);
            }
        } catch (error) {
            console.error('Error adding note:', error);
            alert('Please refresh the YouTube page to enable the extension.');
        }
    }

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

    // Initial load
    loadNotes();

    // Reload notes if tab updates (e.g. navigation to new video)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.active) {
            loadNotes();
        }
    });
});
