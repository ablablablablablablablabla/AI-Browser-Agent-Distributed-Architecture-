chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { action: "getDOM" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            return;
        }

        if (response) {
            sendToPythonBackend(response);
        }
    });
});

async function sendToPythonBackend(data) {
    try {
        const res = await fetch("http://localhost:8000/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                task: "Find login button",
                dom: JSON.stringify(data)
            })
        });
        const json = await res.json();
        console.log(json);
    } catch (e) {
        console.error(e);
    }
}
