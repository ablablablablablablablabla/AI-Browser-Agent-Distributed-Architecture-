document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const taskInput = document.getElementById('taskInput');
    const logsDiv = document.getElementById('logs');
    const securityCheckDiv = document.getElementById('securityCheck');
    const securityReasonDiv = document.getElementById('securityReason');
    const approveBtn = document.getElementById('approveBtn');
    const denyBtn = document.getElementById('denyBtn');

    let globalChatHistory = [];
    let currentActionHistory = [];
    let isAgentRunning = false;
    let securityResolver = null;

    function log(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logsDiv.prepend(entry);
    }

    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    approveBtn.onclick = () => {
        if (securityResolver) {
            securityCheckDiv.style.display = "none";
            securityResolver(true);
        }
    };

    denyBtn.onclick = () => {
        if (securityResolver) {
            securityCheckDiv.style.display = "none";
            securityResolver(false);
        }
    };

    async function waitForUserConfirmation(reason) {
        log(`🔒 STOP: Требуется подтверждение: ${reason}`, "warning");
        securityCheckDiv.style.display = "block";
        securityReasonDiv.textContent = reason;

        return new Promise((resolve) => {
            securityResolver = resolve;
        });
    }

    async function getActiveTab() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0];
    }

    async function ensureContentScript(tabId) {
        try {
            await chrome.tabs.sendMessage(tabId, { type: "PING" });
            return true;
        } catch (e) {
            log("💉 Инъекция скрипта...", "info");
            try {
                await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
                await delay(500);
                return true;
            } catch (err) {
                log(`Ошибка инъекции: ${err.message}`, "error");
                return false;
            }
        }
    }

    async function runAgentLoop() {
        const task = taskInput.value.trim();
        if (!task) return log("Введите задачу!", "error");

        startBtn.disabled = true;
        startBtn.textContent = "Stop 🛑";
        isAgentRunning = true;

        const stopHandler = () => { isAgentRunning = false; };
        startBtn.addEventListener('click', stopHandler, { once: true });

        log(`🚀 START: ${task}`, "info");
        currentActionHistory = [];
        let stepCount = 0;

        try {
            while (stepCount < 30 && isAgentRunning) {
                stepCount++;
                log(`--- ШАГ ${stepCount} ---`, "info");

                const tab = await getActiveTab();
                if (!tab) throw new Error("Нет активной вкладки");

                const scriptReady = await ensureContentScript(tab.id);
                if (!scriptReady) {
                    log("Не могу работать на этой странице (системная?)", "error");
                    break;
                }

                let domData = [];
                let screenshotBase64 = null;

                try {
                    domData = await chrome.tabs.sendMessage(tab.id, { type: "GET_DOM" });
                    screenshotBase64 = await chrome.tabs.captureVisibleTab(null, {format: 'jpeg', quality: 30});
                } catch (e) {
                    log(`Ошибка чтения страницы: ${e.message}`, "error");
                    await delay(1000);
                    continue;
                }

                const requestBody = {
                    task: task,
                    dom: JSON.stringify(domData || []),
                    screenshot: screenshotBase64,
                    action_history: currentActionHistory.slice(-5),
                    chat_history: globalChatHistory
                };

                let aiAction;
                try {
                    const response = await fetch('http://localhost:8000/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                    if (!response.ok) throw new Error(`Server Error: ${response.status}`);
                    aiAction = await response.json();
                } catch (e) {
                    log(`Ошибка сети: ${e.message}`, "error");
                    break;
                }

                if (aiAction.reasoning) {
                    log(`💭 ${aiAction.reasoning}`, "reasoning");
                }

                if (aiAction.needs_confirmation) {
                    const approved = await waitForUserConfirmation(aiAction.reasoning);

                    if (!approved) {
                        log("❌ Пользователь отклонил действие. Остановка.", "error");
                        break;
                    } else {
                        log("✅ Пользователь разрешил действие.", "success");
                        currentActionHistory.push({
                            role: "system",
                            content: "User APPROVED the critical action. Proceed immediately."
                        });
                        continue;
                    }
                }

                if (aiAction.action === "finish") {
                    log(`🎉 ГОТОВО!`, "success");
                    break;
                }

                if (aiAction.action === "save_memory") {
                    const mem = aiAction.text;
                    globalChatHistory.push({ role: "assistant", content: `MEMORY_SAVE: ${mem}` });
                    log(`💾 Запомнил: ${mem}`, "success");
                    currentActionHistory.push(aiAction);
                    await delay(500);
                    continue;
                }

                if (aiAction.action === "open_url") {
                    log(`🌐 Переход: ${aiAction.url}`, "info");
                    currentActionHistory.push(aiAction);
                    await chrome.tabs.update(tab.id, { url: aiAction.url });
                    log("⏳ Жду загрузки (5 сек)...", "info");
                    await delay(5000);
                    continue;
                }

                log(`⚡ ${aiAction.action} -> ID: ${aiAction.element_id}`, "info");

                const res = await chrome.tabs.sendMessage(tab.id, {
                    type: aiAction.action,
                    id: aiAction.element_id,
                    text: aiAction.text
                });

                if (res && res.status && res.status.startsWith("Error")) {
                    log(`⚠️ UI Error: ${res.status}`, "warning");
                    currentActionHistory.push({
                        role: "system",
                        content: `Previous action failed: ${res.status}`
                    });
                } else {
                    currentActionHistory.push(aiAction);
                }

                if (aiAction.action === "scroll") await delay(1500);
                else await delay(2500);
            }

        } catch (e) {
            log(`Критическая ошибка: ${e.message}`, "error");
            console.error(e);
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = "🚀 Start Analysis";
            startBtn.removeEventListener('click', stopHandler);
            isAgentRunning = false;
        }
    }

    startBtn.addEventListener('click', runAgentLoop);
});