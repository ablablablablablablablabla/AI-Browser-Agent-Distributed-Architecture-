(function () {
    if (window.aiAgentInitialized) return;
    window.aiAgentInitialized = true;

console.log("🤖 AI Agent: Smart DOM Engine vFinal Loaded");

const IGNORE_TAGS = ['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT', 'META', 'LINK', 'HEAD', 'TITLE', 'BR', 'HR', 'IFRAME'];
let elementCache = {};

function injectDebugStyles() {
    const styleId = "ai-agent-debug-styles";
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .ai-agent-detected {
        box-shadow: inset 0 0 0 1px rgba(255, 165, 0, 0.3) !important;
        border-radius: 2px;
    }
.ai-agent-active {
        outline: 3px solid #00E676 !important;
        outline-offset: 2px;
        box-shadow: 0 0 20px rgba(0, 230, 118, 0.6) !important;
        background-color: rgba(0, 230, 118, 0.1) !important;
        transition: all 0.2s ease;
        z-index: 999999 !important;
    }
    `;
    document.head.appendChild(style);
}

function isVisible(el) {
    if (!el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 2 && rect.height > 2 &&
        rect.top < window.innerHeight && rect.bottom > 0
    );
}

function isInteractive(el) {
    const tag = el.tagName;
    const style = window.getComputedStyle(el);
    const role = el.getAttribute('role');

    if (['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'DETAILS'].includes(tag)) return true;
    if (['button', 'link', 'checkbox', 'menuitem', 'tab', 'textbox', 'option', 'searchbox', 'combobox', 'switch'].includes(role)) return true;
    if (el.getAttribute('onclick') || el.getAttribute('contenteditable') === 'true') return true;
    if (style.cursor === 'pointer') return true;

    return false;
}

function getSmartText(el) {
    if (['INPUT', 'TEXTAREA'].includes(el.tagName)) return el.value || el.placeholder || "";
    if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.text || "";

    let text = "";
    const imgs = el.querySelectorAll('img');
    imgs.forEach(img => { if(img.alt) text += `[IMG: ${img.alt}] `; });

    text += el.innerText || el.textContent || "";

    if (text.trim().length < 1) {
        text = el.getAttribute('aria-label') || el.getAttribute('title') || "";
    }

    return text.replace(/\s+/g, " ").trim().substring(0, 200);
}

function parsePage() {
    injectDebugStyles();

    document.querySelectorAll('.ai-agent-detected').forEach(el => el.classList.remove('ai-agent-detected'));

    elementCache = {};
    const parsedElements = [];
    let idCounter = 1;

    const allElements = document.querySelectorAll('*');

    allElements.forEach(el => {
        if (IGNORE_TAGS.includes(el.tagName)) return;
        if (!isVisible(el)) return;

        if (isInteractive(el)) {
            const text = getSmartText(el);

            if (!text && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
                return;
            }

            const currentId = idCounter++;
            el.setAttribute('data-agent-id', currentId);
            el.classList.add('ai-agent-detected');

            elementCache[currentId] = el;

            parsedElements.push({
                id: currentId,
                tag: el.tagName.toLowerCase(),
                text: text,
                attributes: {
                    type: el.getAttribute('type'),
                    placeholder: el.getAttribute('placeholder'),
                    ariaLabel: el.getAttribute('aria-label'),
                    name: el.getAttribute('name'),
                    role: el.getAttribute('role'),
                    href: el.getAttribute('href'),
                    checked: el.checked
                }
            });
        }
    });

    return parsedElements;
}

function setNativeValue(element, value) {
    const lastValue = element.value;
    element.value = value;
    const event = new Event('input', { bubbles: true });
    const tracker = element._valueTracker;
    if (tracker) {
        tracker.setValue(lastValue);
    }
    element.dispatchEvent(event);
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function executeAction(request) {
    const { type, id, text } = request;

    if (type === "scroll") {
        const direction = text || "down";
        const amount = window.innerHeight * 0.8;

        if (direction === "up") window.scrollBy({ top: -amount, behavior: 'smooth' });
        else if (direction === "top") window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (direction === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else window.scrollBy({ top: amount, behavior: 'smooth' });

        await new Promise(r => setTimeout(r, 800));
        return "Scrolled";
    }

    let element = elementCache[id] || document.querySelector(`[data-agent-id="${id}"]`);

    if (!element) return `Error: Element ID ${id} not found (stale DOM?)`;

    if (type === "click" && !isInteractive(element)) {
        const parent = element.closest('a, button, input, [role="button"]');
        if (parent) {
            console.log("🔧 Auto-corrected target to parent interactive element");
            element = parent;
        }
    }

    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    element.classList.add('ai-agent-active');
    await new Promise(r => setTimeout(r, 600));

    try {
        if (type === "click") {
            element.focus();
            ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
                const mouseEvent = new MouseEvent(evtType, {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    buttons: 1
                });
                element.dispatchEvent(mouseEvent);
            });
        }
        else if (type === "type") {
            element.focus();
            setNativeValue(element, text);
            element.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        else if (type === "press_enter") {
            element.focus();
            ['keydown', 'keypress', 'keyup'].forEach(evtType => {
                element.dispatchEvent(new KeyboardEvent(evtType, {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                }));
            });
        }
        else if (type === "open_url") {
            window.location.href = text;
        }

    } catch (e) {
        return `Error executing ${type}: ${e.message}`;
    } finally {
        setTimeout(() => element.classList.remove('ai-agent-active'), 1500);
    }

    return "Done";
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === "GET_DOM") {
        requestAnimationFrame(() => {
            const domData = parsePage();
            sendResponse(domData);
        });
        return true;
    }

    if (req.type === "PING") {
        sendResponse("PONG");
        return false;
    }

    if (["click", "type", "scroll", "press_enter", "open_url"].includes(req.type)) {
        executeAction(req).then(status => sendResponse({ status }));
        return true;
    }
});



})();
