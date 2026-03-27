const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG || '/data/data/com.termux/files/home/.openclaw/openclaw.json';
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'chat-store.json');
const GATEWAY_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS || 120000);

function logStep(requestId, message, extra) {
    const suffix = extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    console.log(`[${requestId}] ${message}${suffix}`);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function nowIso() {
    return new Date().toISOString();
}

function uid(prefix = '') {
    return `${prefix}${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function toPlainText(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/[>#*_\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function deriveTitleFromMessages(messages = []) {
    const firstUser = messages.find(msg => msg.role === 'user' && toPlainText(msg.content));
    const base = toPlainText(firstUser?.content || 'Chat Baru');
    return base.slice(0, 60) || 'Chat Baru';
}

function deriveLastPreview(messages = []) {
    const last = [...messages].reverse().find(msg => toPlainText(msg.content));
    return toPlainText(last?.content || 'Belum ada pesan.').slice(0, 160);
}

function normalizeAttachment(attachment = {}) {
    return {
        id: attachment.id || uid('att_'),
        name: attachment.name || attachment.fileName || 'attachment',
        type: attachment.type || attachment.mimeType || 'application/octet-stream',
        size: Number(attachment.size || 0),
        localPath: attachment.localPath || null,
        previewUrl: attachment.previewUrl || null,
        createdAt: attachment.createdAt || nowIso()
    };
}

function normalizeMessage(sessionId, message = {}) {
    return {
        id: message.id || uid('msg_'),
        sessionId,
        role: message.role || 'assistant',
        content: String(message.content || ''),
        model: message.model || null,
        status: message.status || 'done',
        replyToMessageId: message.replyToMessageId || null,
        metadata: message.metadata || {},
        attachments: Array.isArray(message.attachments) ? message.attachments.map(normalizeAttachment) : [],
        createdAt: message.createdAt || nowIso(),
        updatedAt: message.updatedAt || null
    };
}

function normalizeSession(session = {}) {
    const id = session.id || uid('sess_');
    const messages = Array.isArray(session.messages) ? session.messages.map(msg => normalizeMessage(id, msg)) : [];
    const createdAt = session.createdAt || nowIso();
    const updatedAt = session.updatedAt || createdAt;
    const title = session.title || deriveTitleFromMessages(messages);
    const lastModel = session.lastModel || [...messages].reverse().map(msg => msg.model).find(Boolean) || null;
    const attachments = messages.flatMap(msg => msg.attachments || []);

    return {
        id,
        title,
        summary: session.summary || '',
        keyPoints: Array.isArray(session.keyPoints) ? session.keyPoints : [],
        todos: Array.isArray(session.todos) ? session.todos : [],
        lastMessagePreview: session.lastMessagePreview || deriveLastPreview(messages),
        lastModel,
        messageCount: Number(session.messageCount || messages.length),
        attachmentCount: Number(session.attachmentCount || attachments.length),
        pinned: Boolean(session.pinned),
        archived: Boolean(session.archived),
        deleted: Boolean(session.deleted),
        createdAt,
        updatedAt,
        messages
    };
}

function createStoreShape() {
    const session = normalizeSession({
        title: 'Chat Baru',
        messages: [{
            role: 'assistant',
            content: 'Hey! 👋 Ready to help. Upload images, PDFs, text files, or send your task directly.',
            metadata: { source: 'seed' },
            createdAt: nowIso()
        }]
    });

    return {
        version: 1,
        sessions: [session]
    };
}

function loadStore() {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(STORE_PATH)) {
        const initialStore = createStoreShape();
        writeJson(STORE_PATH, initialStore);
        return initialStore;
    }

    const raw = readJsonSafe(STORE_PATH, createStoreShape());
    return {
        version: 1,
        sessions: Array.isArray(raw.sessions) ? raw.sessions.map(normalizeSession) : []
    };
}

function saveStore(store) {
    const normalized = {
        version: 1,
        sessions: (store.sessions || []).map(normalizeSession)
    };
    writeJson(STORE_PATH, normalized);
    return normalized;
}

function listActiveSessions(store) {
    return (store.sessions || []).filter(session => !session.deleted);
}

function sortSessions(sessions) {
    return [...sessions].sort((a, b) => {
        if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

function getSessionById(store, sessionId) {
    return (store.sessions || []).find(session => session.id === sessionId && !session.deleted) || null;
}

function refreshSessionDerivedFields(session) {
    session.messageCount = session.messages.length;
    session.attachmentCount = session.messages.flatMap(msg => msg.attachments || []).length;
    session.lastMessagePreview = deriveLastPreview(session.messages);
    session.lastModel = [...session.messages].reverse().map(msg => msg.model).find(Boolean) || session.lastModel || null;

    if (!session.title || session.title === 'Chat Baru') {
        session.title = deriveTitleFromMessages(session.messages);
    }

    if (!session.summary) {
        const assistant = session.messages.find(msg => msg.role === 'assistant' && toPlainText(msg.content));
        session.summary = toPlainText(assistant?.content || '').slice(0, 220);
    }

    return session;
}

function sessionListItem(session) {
    return {
        id: session.id,
        title: session.title,
        summary: session.summary,
        lastMessagePreview: session.lastMessagePreview,
        lastModel: session.lastModel,
        messageCount: session.messageCount,
        attachmentCount: session.attachmentCount,
        pinned: session.pinned,
        archived: session.archived,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt
    };
}

function getLastUserMessage(session) {
    return [...(session?.messages || [])].reverse().find(msg => msg.role === 'user') || null;
}

function getLastAssistantMessage(session) {
    return [...(session?.messages || [])].reverse().find(msg => msg.role === 'assistant') || null;
}

function removeMessageById(session, messageId) {
    const index = (session.messages || []).findIndex(msg => msg.id === messageId);
    if (index >= 0) session.messages.splice(index, 1);
}

function searchSnippet(content, term) {
    const text = toPlainText(content);
    const lower = text.toLowerCase();
    const q = term.toLowerCase();
    const index = lower.indexOf(q);
    if (index < 0) return text.slice(0, 140);
    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + q.length + 60);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function readOpenClawConfig() {
    try {
        return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    } catch (error) {
        console.warn('⚠️ Failed to read OpenClaw config:', error.message);
        return {};
    }
}

function getRuntimeConfig() {
    const config = readOpenClawConfig();
    const gatewayUrl = process.env.GATEWAY_URL || `http://127.0.0.1:${config?.gateway?.port || 18789}`;
    const gatewayToken = process.env.GATEWAY_TOKEN || config?.gateway?.auth?.token || '';
    const agentId = process.env.OPENCLAW_AGENT_ID || config?.agents?.list?.[0]?.id || 'main';
    const defaultModel = config?.agents?.defaults?.model?.primary || `openclaw:${agentId}`;
    const providerModels = (config?.models?.providers ? Object.entries(config.models.providers).flatMap(([providerId, provider]) =>
        (provider.models || []).map((model) => ({
            id: `${providerId}/${model.id}`,
            name: model.name || model.id,
            provider: providerId,
            contextWindow: model.contextWindow || null,
            reasoning: Boolean(model.reasoning)
        }))
    ) : []);

    const allowedAgentModels = Object.keys(config?.agents?.defaults?.models || {}).map((id) => ({
        id,
        name: id,
        provider: id.includes('/') ? id.split('/')[0] : 'custom',
        contextWindow: null,
        reasoning: false
    }));

    const dedup = new Map();
    for (const item of [...providerModels, ...allowedAgentModels, { id: `openclaw:${agentId}`, name: `OpenClaw Agent (${agentId})`, provider: 'openclaw', contextWindow: null, reasoning: false }]) {
        if (!dedup.has(item.id)) dedup.set(item.id, item);
    }

    const models = [...dedup.values()];

    const allowedModelIds = Object.keys(config?.agents?.defaults?.models || {});

    return {
        gatewayUrl,
        gatewayToken,
        agentId,
        defaultModel,
        models,
        allowedModelIds
    };
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        ensureDir(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json({ limit: '5mb' }));

app.get('/api/config', (req, res) => {
    const runtime = getRuntimeConfig();
    res.json({
        success: true,
        gatewayUrl: runtime.gatewayUrl,
        agentId: runtime.agentId,
        defaultModel: runtime.defaultModel,
        models: runtime.models
    });
});

app.get('/api/sessions', (req, res) => {
    const store = loadStore();
    const q = String(req.query.q || '').trim().toLowerCase();
    const archived = req.query.archived;
    const pinned = req.query.pinned;
    const limit = Number(req.query.limit || 100);

    let sessions = listActiveSessions(store);

    if (archived === 'true') sessions = sessions.filter(session => session.archived);
    if (archived === 'false') sessions = sessions.filter(session => !session.archived);
    if (pinned === 'true') sessions = sessions.filter(session => session.pinned);
    if (pinned === 'false') sessions = sessions.filter(session => !session.pinned);

    if (q) {
        sessions = sessions.filter(session => {
            const haystack = [
                session.title,
                session.summary,
                session.lastMessagePreview,
                ...session.messages.map(msg => msg.content)
            ].join('\n').toLowerCase();
            return haystack.includes(q);
        });
    }

    const items = sortSessions(sessions).slice(0, limit).map(sessionListItem);
    res.json({ items, nextCursor: null });
});

app.post('/api/sessions', (req, res) => {
    const store = loadStore();
    const { mode = 'clean', title, sourceSessionId = null, seedSummary = null } = req.body || {};
    const source = sourceSessionId ? getSessionById(store, sourceSessionId) : null;
    const createdAt = nowIso();

    const session = normalizeSession({
        id: uid('sess_'),
        title: title || 'Chat Baru',
        summary: seedSummary || '',
        keyPoints: source && mode === 'with_context' ? [...(source.keyPoints || [])] : [],
        todos: source && mode === 'with_context' ? [...(source.todos || [])] : [],
        pinned: false,
        archived: false,
        deleted: false,
        createdAt,
        updatedAt: createdAt,
        messages: mode === 'with_context' && source ? [{
            role: 'assistant',
            content: `Context dibawa dari session: ${source.title}\n\nSummary: ${source.summary || 'Belum ada summary.'}`,
            metadata: { source: 'branch-context', sourceSessionId },
            createdAt
        }] : [{
            role: 'assistant',
            content: 'Sesi baru siap dipakai.',
            metadata: { source: 'new-session' },
            createdAt
        }]
    });

    refreshSessionDerivedFields(session);
    store.sessions.unshift(session);
    saveStore(store);
    res.status(201).json(sessionListItem(session));
});

app.get('/api/sessions/:id', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
});

app.patch('/api/sessions/:id', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const patch = req.body || {};
    if (typeof patch.title === 'string') session.title = patch.title.trim() || session.title;
    if (typeof patch.summary === 'string') session.summary = patch.summary;
    if (Array.isArray(patch.keyPoints)) session.keyPoints = patch.keyPoints.map(String);
    if (Array.isArray(patch.todos)) session.todos = patch.todos.map(String);
    if (typeof patch.pinned === 'boolean') session.pinned = patch.pinned;
    if (typeof patch.archived === 'boolean') session.archived = patch.archived;
    session.updatedAt = nowIso();
    refreshSessionDerivedFields(session);
    saveStore(store);
    res.json(sessionListItem(session));
});

app.delete('/api/sessions/:id', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.deleted = true;
    session.updatedAt = nowIso();
    saveStore(store);
    res.json({ ok: true, deleted: true });
});

app.get('/api/sessions/:id/messages', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    let items = [...session.messages];
    if (req.query.after) items = items.filter(msg => new Date(msg.createdAt) > new Date(req.query.after));
    if (req.query.before) items = items.filter(msg => new Date(msg.createdAt) < new Date(req.query.before));
    if (req.query.limit) items = items.slice(-Number(req.query.limit));

    res.json({ items });
});

app.post('/api/sessions/:id/messages', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const message = normalizeMessage(session.id, req.body || {});
    session.messages.push(message);
    session.updatedAt = nowIso();
    refreshSessionDerivedFields(session);
    saveStore(store);
    res.status(201).json(message);
});

app.get('/api/search/messages', (req, res) => {
    const store = loadStore();
    const q = String(req.query.q || '').trim();
    const sessionId = String(req.query.sessionId || '').trim();
    const limit = Number(req.query.limit || 20);

    if (!q) return res.json({ items: [] });

    let sessions = listActiveSessions(store);
    if (sessionId) sessions = sessions.filter(session => session.id === sessionId);

    const items = sessions.flatMap(session =>
        session.messages
            .filter(msg => msg.content.toLowerCase().includes(q.toLowerCase()))
            .map(msg => ({
                sessionId: session.id,
                sessionTitle: session.title,
                messageId: msg.id,
                snippet: searchSnippet(msg.content, q),
                createdAt: msg.createdAt
            }))
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);

    res.json({ items });
});

app.get('/api/sessions/:id/summary', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({
        summary: session.summary || '',
        keyPoints: session.keyPoints || [],
        todos: session.todos || []
    });
});

app.put('/api/sessions/:id/summary', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.summary = String(req.body.summary || '');
    session.keyPoints = Array.isArray(req.body.keyPoints) ? req.body.keyPoints.map(String) : [];
    session.todos = Array.isArray(req.body.todos) ? req.body.todos.map(String) : [];
    session.updatedAt = nowIso();
    refreshSessionDerivedFields(session);
    saveStore(store);

    res.json({
        summary: session.summary,
        keyPoints: session.keyPoints,
        todos: session.todos
    });
});

app.get('/api/sessions/:id/attachments', (req, res) => {
    const store = loadStore();
    const session = getSessionById(store, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const items = session.messages.flatMap(msg =>
        (msg.attachments || []).map(att => ({
            ...att,
            messageId: msg.id,
            createdAt: att.createdAt || msg.createdAt
        }))
    );

    res.json({ items });
});

app.post('/api/messages/:id/branch', (req, res) => {
    const store = loadStore();
    const messageId = req.params.id;
    const mode = req.body?.mode || 'summary_only';

    const sourceSession = listActiveSessions(store).find(session => session.messages.some(msg => msg.id === messageId));
    if (!sourceSession) return res.status(404).json({ error: 'Message not found' });

    const sourceMessageIndex = sourceSession.messages.findIndex(msg => msg.id === messageId);
    const sourceMessage = sourceSession.messages[sourceMessageIndex];
    const createdAt = nowIso();

    const newSession = normalizeSession({
        id: uid('sess_'),
        title: `${sourceSession.title} (branch)`,
        summary: sourceSession.summary || '',
        keyPoints: [...(sourceSession.keyPoints || [])],
        todos: [...(sourceSession.todos || [])],
        createdAt,
        updatedAt: createdAt,
        messages: [{
            role: 'assistant',
            content: mode === 'summary_only'
                ? `Branch dibuat dari session \"${sourceSession.title}\" pada message tertentu.\n\nSummary lama: ${sourceSession.summary || 'Belum ada summary.'}`
                : `Branch dibuat dari session \"${sourceSession.title}\".\n\nMessage sumber:\n${sourceMessage.content}`,
            metadata: {
                source: 'branch',
                sourceSessionId: sourceSession.id,
                sourceMessageId: sourceMessage.id,
                sourceMessageIndex
            },
            createdAt
        }]
    });

    refreshSessionDerivedFields(newSession);
    store.sessions.unshift(newSession);
    saveStore(store);
    res.status(201).json({ newSessionId: newSession.id });
});

app.delete('/api/messages/:id', (req, res) => {
    const store = loadStore();
    const messageId = req.params.id;
    const sourceSession = listActiveSessions(store).find(session => session.messages.some(msg => msg.id === messageId));
    if (!sourceSession) return res.status(404).json({ error: 'Message not found' });

    const target = sourceSession.messages.find(msg => msg.id === messageId);
    if (!target) return res.status(404).json({ error: 'Message not found' });

    sourceSession.messages = sourceSession.messages.filter(msg => msg.id !== messageId);
    sourceSession.updatedAt = nowIso();
    refreshSessionDerivedFields(sourceSession);
    saveStore(store);
    res.json({ ok: true, deleted: true, sessionId: sourceSession.id, role: target.role });
});

app.post('/api/messages/:id/edit-resend', async (req, res) => {
    const requestId = uid('req_');
    const startedAt = Date.now();

    try {
        const store = loadStore();
        const messageId = req.params.id;
        const sourceSession = listActiveSessions(store).find(session => session.messages.some(msg => msg.id === messageId));
        if (!sourceSession) return res.status(404).json({ error: 'Message not found' });

        const sourceIndex = sourceSession.messages.findIndex(msg => msg.id === messageId);
        const sourceMessage = sourceSession.messages[sourceIndex];
        if (!sourceMessage || sourceMessage.role !== 'user') {
            return res.status(400).json({ error: 'Only user messages can be edited and resent' });
        }

        const nextContent = String(req.body?.content || '').trim();
        if (!nextContent) return res.status(400).json({ error: 'Edited content is required' });

        sourceSession.messages = sourceSession.messages.slice(0, sourceIndex);

        const editedUserMessage = normalizeMessage(sourceSession.id, {
            role: 'user',
            content: nextContent,
            attachments: sourceMessage.attachments || [],
            metadata: {
                ...(sourceMessage.metadata || {}),
                editedFromMessageId: sourceMessage.id,
                source: 'web-ui-edit-resend'
            },
            createdAt: nowIso()
        });
        sourceSession.messages.push(editedUserMessage);

        const attachmentFiles = (editedUserMessage.attachments || [])
            .filter(att => att.localPath && fs.existsSync(att.localPath))
            .map(att => ({
                path: att.localPath,
                originalname: att.name,
                mimetype: att.type,
                size: att.size
            }));

        const reply = await sendToOpenClaw({
            requestId,
            message: editedUserMessage.content,
            files: attachmentFiles,
            model: req.body?.model || sourceSession.lastModel || null,
            sessionId: sourceSession.id
        });

        const assistantMessage = normalizeMessage(sourceSession.id, {
            role: 'assistant',
            content: reply,
            model: req.body?.model || sourceSession.lastModel || getRuntimeConfig().defaultModel,
            metadata: { source: 'openclaw', replyToMessageId: editedUserMessage.id },
            createdAt: nowIso()
        });
        sourceSession.messages.push(assistantMessage);
        sourceSession.updatedAt = nowIso();
        refreshSessionDerivedFields(sourceSession);
        saveStore(store);

        res.json({
            success: true,
            requestId,
            timingMs: Date.now() - startedAt,
            session: sessionListItem(sourceSession),
            userMessage: editedUserMessage,
            assistantMessage
        });
    } catch (error) {
        logStep(requestId, '❌ Edit resend failed', {
            durationMs: Date.now() - startedAt,
            name: error.name,
            code: error.code,
            message: error.message
        });
        res.status(500).json({ success: false, requestId, error: error.message });
    }
});

app.post('/v1/chat', upload.array('files', 5), async (req, res) => {
    const requestId = uid('req_');
    const startedAt = Date.now();

    try {
        const { message, model, sessionId } = req.body;
        const files = req.files || [];
        const store = loadStore();

        logStep(requestId, '📩 New message received', {
            sessionId: sessionId || null,
            model: model || '(default)',
            fileCount: files.length,
            preview: String(message || '').slice(0, 120)
        });

        let session = sessionId ? getSessionById(store, sessionId) : null;
        if (!session) {
            session = normalizeSession({
                id: sessionId || uid('sess_'),
                title: 'Chat Baru',
                createdAt: nowIso(),
                updatedAt: nowIso(),
                messages: []
            });
            store.sessions.unshift(session);
        }

        const fileAttachments = files.map(file => normalizeAttachment({
            name: file.originalname,
            type: file.mimetype,
            size: file.size,
            localPath: file.path,
            createdAt: nowIso()
        }));

        if ((message && message.trim()) || fileAttachments.length) {
            const userMessage = normalizeMessage(session.id, {
                role: 'user',
                content: message || fileAttachments.map(file => `[Attached file: ${file.name}]`).join('\n'),
                attachments: fileAttachments,
                metadata: { source: 'web-ui' },
                createdAt: nowIso()
            });
            session.messages.push(userMessage);
        }

        logStep(requestId, '➡️ Forwarding request to OpenClaw gateway', {
            gateway: getRuntimeConfig().gatewayUrl,
            sessionId: session.id
        });

        const reply = await sendToOpenClaw({
            requestId,
            message: message || '',
            files,
            model,
            sessionId: session.id
        });

        logStep(requestId, '✅ Reply received from OpenClaw gateway', {
            durationMs: Date.now() - startedAt,
            replyLength: String(reply || '').length
        });

        const assistantMessage = normalizeMessage(session.id, {
            role: 'assistant',
            content: reply,
            model: model && model !== 'routing:auto' ? model : getRuntimeConfig().defaultModel,
            metadata: { source: 'openclaw' },
            createdAt: nowIso()
        });
        session.messages.push(assistantMessage);
        session.updatedAt = nowIso();
        refreshSessionDerivedFields(session);
        saveStore(store);

        res.json({
            success: true,
            reply,
            model: assistantMessage.model,
            requestId,
            timingMs: Date.now() - startedAt,
            session: sessionListItem(session)
        });

        setTimeout(() => {
            files.forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }, 5000);
    } catch (error) {
        logStep(requestId, '❌ Request failed', {
            durationMs: Date.now() - startedAt,
            name: error.name,
            code: error.code,
            type: error.type,
            message: error.message
        });
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            requestId,
            error: error.message
        });
    }
});

function sseWrite(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function extractStreamDelta(parsed) {
    return parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || '';
}

function buildUserContent(message, files = []) {
    const content = [];

    if (message && message.trim()) {
        content.push({ type: 'text', text: message.trim() });
    }

    for (const file of files) {
        const mime = file.mimetype || 'application/octet-stream';
        const base64 = fs.readFileSync(file.path).toString('base64');

        if (mime.startsWith('image/')) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: `data:${mime};base64,${base64}`
                }
            });
        } else {
            const textLike = mime.startsWith('text/') || ['application/json'].includes(mime);
            if (textLike) {
                const fileText = fs.readFileSync(file.path, 'utf8');
                content.push({
                    type: 'text',
                    text: `\n\n[Attached file: ${file.originalname}]\n${fileText}`
                });
            } else {
                content.push({
                    type: 'text',
                    text: `\n\n[Attached file: ${file.originalname} | type=${mime} | size=${file.size} bytes]`
                });
            }
        }
    }

    if (content.length === 0) {
        content.push({ type: 'text', text: '' });
    }

    return content;
}

async function sendToOpenClaw({ requestId, message, files = [], model, sessionId, stream = false, onToken = null, signal = null }) {
    const runtime = getRuntimeConfig();
    const preferredModel = model && model !== 'routing:auto' ? model : null;

    const messages = [];

    messages.push({
        role: 'user',
        content: buildUserContent(message, files)
    });

    const primaryModel = preferredModel || runtime.defaultModel || `openclaw:${runtime.agentId}`;
    const fallbacks = (runtime.allowedModelIds || []).filter((id) => id && id !== primaryModel);
    const modelCandidates = [...new Set([primaryModel, ...fallbacks])];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', abortFromCaller, { once: true });
    }

    let response;
    let lastErrorText = '';

    try {
        for (let i = 0; i < modelCandidates.length; i++) {
            const targetModel = modelCandidates[i];
            const payload = {
                model: targetModel,
                user: sessionId || 'openclaw-control-ui',
                messages,
                stream
            };

            logStep(requestId, '🛰️ Waiting for gateway response', {
                timeoutMs: GATEWAY_TIMEOUT_MS,
                agentId: runtime.agentId,
                mode: preferredModel ? 'manual' : 'auto',
                targetModel,
                attempt: i + 1,
                totalCandidates: modelCandidates.length
            });

            response = await fetch(`${runtime.gatewayUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(runtime.gatewayToken && { 'Authorization': `Bearer ${runtime.gatewayToken}` }),
                    'x-openclaw-agent-id': runtime.agentId,
                    'x-openclaw-session-key': sessionId || 'openclaw-control-ui'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (response.ok) break;

            const text = await response.text();
            lastErrorText = text;
            const retryable = response.status === 429 || response.status === 402 || /rate|quota|limit|insufficient|exhausted|credit/i.test(text || '');

            logStep(requestId, '⚠️ Gateway returned non-OK response', {
                status: response.status,
                statusText: response.statusText,
                targetModel,
                retryable,
                bodyPreview: String(text || '').slice(0, 300)
            });

            if (!retryable || i === modelCandidates.length - 1) {
                throw new Error(`Gateway error: ${response.status} ${response.statusText} - ${text}`);
            }

            logStep(requestId, '🔁 Retrying with fallback model', {
                fromModel: targetModel,
                toModel: modelCandidates[i + 1]
            });
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeoutError = new Error(`Gateway timeout after ${Math.round(GATEWAY_TIMEOUT_MS / 1000)}s while waiting for OpenClaw response`);
            timeoutError.code = 'GATEWAY_TIMEOUT';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener?.('abort', abortFromCaller);
    }

    if (!response || !response.ok) {
        throw new Error(lastErrorText || 'Gateway request failed');
    }

    if (stream) {
        let fullText = '';
        let buffer = '';

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete trailing line in buffer

            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw || raw === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(raw);
                    const delta = extractStreamDelta(parsed);
                    if (delta) {
                        fullText += delta;
                        if (onToken) onToken(delta, fullText);
                    }
                } catch {
                    // ignore non-json chunks
                }
            }
        }

        // flush remaining buffer
        if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith('data:')) {
                const raw = line.slice(5).trim();
                if (raw && raw !== '[DONE]') {
                    try {
                        const parsed = JSON.parse(raw);
                        const delta = extractStreamDelta(parsed);
                        if (delta) {
                            fullText += delta;
                            if (onToken) onToken(delta, fullText);
                        }
                    } catch {}
                }
            }
        }

        logStep(requestId, '📦 Gateway stream completed', {
            replyLength: fullText.length
        });
        return fullText || 'No response from OpenClaw';
    }

    const data = await response.json();
    logStep(requestId, '📦 Gateway JSON parsed', {
        hasChoices: Boolean(data?.choices?.length)
    });
    return data?.choices?.[0]?.message?.content || 'No response from OpenClaw';
}

app.post('/api/sessions/:id/regenerate', async (req, res) => {
    const requestId = uid('req_');
    const startedAt = Date.now();

    try {
        const store = loadStore();
        const session = getSessionById(store, req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const lastUser = getLastUserMessage(session);
        const lastAssistant = getLastAssistantMessage(session);
        if (!lastUser) return res.status(400).json({ error: 'No user message to regenerate from' });
        if (lastAssistant && new Date(lastAssistant.createdAt) > new Date(lastUser.createdAt)) {
            removeMessageById(session, lastAssistant.id);
        }

        const attachmentFiles = (lastUser.attachments || [])
            .filter(att => att.localPath && fs.existsSync(att.localPath))
            .map(att => ({
                path: att.localPath,
                originalname: att.name,
                mimetype: att.type,
                size: att.size
            }));

        logStep(requestId, '🔁 Regenerating last assistant reply', {
            sessionId: session.id,
            basedOnMessageId: lastUser.id
        });

        const reply = await sendToOpenClaw({
            requestId,
            message: lastUser.content || '',
            files: attachmentFiles,
            model: req.body?.model || session.lastModel || null,
            sessionId: session.id
        });

        const assistantMessage = normalizeMessage(session.id, {
            role: 'assistant',
            content: reply,
            model: req.body?.model || session.lastModel || getRuntimeConfig().defaultModel,
            metadata: { source: 'openclaw', regenerated: true, basedOnMessageId: lastUser.id },
            createdAt: nowIso()
        });
        session.messages.push(assistantMessage);
        session.updatedAt = nowIso();
        refreshSessionDerivedFields(session);
        saveStore(store);

        res.json({
            success: true,
            reply,
            model: assistantMessage.model,
            requestId,
            timingMs: Date.now() - startedAt,
            session: sessionListItem(session),
            message: assistantMessage
        });
    } catch (error) {
        logStep(requestId, '❌ Regenerate failed', {
            durationMs: Date.now() - startedAt,
            name: error.name,
            code: error.code,
            message: error.message
        });
        res.status(500).json({ success: false, requestId, error: error.message });
    }
});

app.post('/v1/chat/stream', upload.array('files', 5), async (req, res) => {
    const requestId = uid('req_');
    const startedAt = Date.now();
    const clientAbortController = new AbortController();

    req.on('aborted', () => {
        if (!res.writableEnded) {
            logStep(requestId, '🛑 Client request aborted during streaming');
            clientAbortController.abort();
        }
    });

    res.on('close', () => {
        if (!res.writableEnded) {
            logStep(requestId, '🛑 Response closed before streaming completed');
            clientAbortController.abort();
        }
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
        const { message, model, sessionId } = req.body;
        const files = req.files || [];
        const store = loadStore();

        let session = sessionId ? getSessionById(store, sessionId) : null;
        if (!session) {
            session = normalizeSession({
                id: sessionId || uid('sess_'),
                title: 'Chat Baru',
                createdAt: nowIso(),
                updatedAt: nowIso(),
                messages: []
            });
            store.sessions.unshift(session);
        }

        const fileAttachments = files.map(file => normalizeAttachment({
            name: file.originalname,
            type: file.mimetype,
            size: file.size,
            localPath: file.path,
            createdAt: nowIso()
        }));

        if ((message && message.trim()) || fileAttachments.length) {
            const userMessage = normalizeMessage(session.id, {
                role: 'user',
                content: message || fileAttachments.map(file => `[Attached file: ${file.name}]`).join('\n'),
                attachments: fileAttachments,
                metadata: { source: 'web-ui' },
                createdAt: nowIso()
            });
            session.messages.push(userMessage);
        }

        logStep(requestId, '🌊 Streaming request started', {
            sessionId: session.id,
            model: model || '(default)',
            fileCount: files.length,
            preview: String(message || '').slice(0, 120)
        });

        sseWrite(res, 'meta', { requestId, sessionId: session.id });
        sseWrite(res, 'status', { stage: 'forwarding', message: 'Meneruskan request ke OpenClaw Gateway...' });

        const reply = await sendToOpenClaw({
            requestId,
            message: message || '',
            files,
            model,
            sessionId: session.id,
            stream: true,
            signal: clientAbortController.signal,
            onToken: (delta, fullText) => {
                sseWrite(res, 'token', { delta, text: fullText });
            }
        });

        const assistantMessage = normalizeMessage(session.id, {
            role: 'assistant',
            content: reply,
            model: model && model !== 'routing:auto' ? model : getRuntimeConfig().defaultModel,
            metadata: { source: 'openclaw' },
            createdAt: nowIso()
        });
        session.messages.push(assistantMessage);
        session.updatedAt = nowIso();
        refreshSessionDerivedFields(session);
        saveStore(store);

        sseWrite(res, 'done', {
            success: true,
            reply,
            model: assistantMessage.model,
            requestId,
            timingMs: Date.now() - startedAt,
            session: sessionListItem(session)
        });
    } catch (error) {
        logStep(requestId, '❌ Streaming request failed', {
            durationMs: Date.now() - startedAt,
            name: error.name,
            code: error.code,
            type: error.type,
            message: error.message
        });
        sseWrite(res, 'error', {
            success: false,
            requestId,
            error: error.message
        });
    } finally {
        setTimeout(() => {
            try { res.end(); } catch {}
        }, 50);
    }
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
    const runtime = getRuntimeConfig();
    const store = loadStore();
    console.log('🚀 OpenClaw Chat UI running at:');
    console.log(`   http://localhost:${PORT}`);
    console.log(`   http://0.0.0.0:${PORT}`);
    console.log(`🔌 Gateway: ${runtime.gatewayUrl}`);
    console.log(`🤖 Default model: ${runtime.defaultModel}`);
    console.log(`💾 Store: ${STORE_PATH}`);
    console.log(`🗂️ Sessions: ${listActiveSessions(store).length}`);
});