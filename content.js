// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const video = document.querySelector('video');

    if (!video) {
        sendResponse({ error: 'No video found' });
        return;
    }

    if (request.action === 'GET_TIME') {
        sendResponse({ currentTime: video.currentTime });
    } else if (request.action === 'SEEK_TO') {
        video.currentTime = request.time;
        video.play(); // Optional: ensure video plays after seeking
    }
});
