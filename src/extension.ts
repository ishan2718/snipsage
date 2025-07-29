import * as vscode from 'vscode';
import * as path from 'path';

// --- Define a type for the expected Gemini API response structure ---
interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

let lastExplainedRange: vscode.Range | null = null;
let lastExplanation: string | null = null;

// --- Reusable function to call the Gemini API ---
async function callGemini(prompt: string, apiKey: string): Promise<string> {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error('Gemini API Error:', errorBody);
        throw new Error(`API request failed with status ${response.status}. Check the console for details.`);
    }

    const result = await response.json() as GeminiResponse;
    
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (rawText) {
        return rawText;
    } else {
        console.error('Unexpected API response structure:', result);
        throw new Error('Could not extract a valid response from the API.');
    }
}

// --- UPDATED: Function to get the API key with a more user-friendly flow ---
async function getApiKey(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('snipsage');
    let apiKey = config.get<string>('apiKey');

    if (!apiKey) {
        // Show a more helpful message first, with clickable actions.
        const getApiKeyChoice = await vscode.window.showInformationMessage(
            'SnipSage requires a Google Gemini API key to function. You can get a free key from Google AI Studio.',
            { modal: true }, // Makes the user have to choose an option
            'Get API Key',
            'Cancel'
        );

        if (getApiKeyChoice === 'Get API Key') {
            // Open the browser to the correct page for the user.
            vscode.env.openExternal(vscode.Uri.parse('https://aistudio.google.com/app/apikey'));

            // Then, show the input box for them to paste the key.
            apiKey = await vscode.window.showInputBox({
                prompt: 'Please paste your new Google Gemini API Key here',
                placeHolder: 'Your API key',
                password: true,
                ignoreFocusOut: true,
            });

            if (apiKey) {
                // Save the key to the global settings for future use.
                await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('SnipSage API key saved successfully!');
            }
        }
    }
    return apiKey;
}

// --- Function to display explanation in a Webview Panel ---
function showExplanationInWebview(explanation: string) {
    const panel = vscode.window.createWebviewPanel('snipSageExplanation', 'SnipSage Explanation', vscode.ViewColumn.Beside, {});
    const formattedExplanation = explanation
        .replace(/```([\w\s]*)\n([\s\S]*?)```/g, (match, lang, code) => `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^\* (.*$)/gm, '<ul><li>$1</li></ul>').replace(/\n/g, '<br>');

    panel.webview.html = `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SnipSage Explanation</title><style>body{background-color:#1e1e1e;color:#d4d4d4;font-family:sans-serif;padding:20px;line-height:1.6}pre{background-color:#252526;padding:1em;border-radius:5px;white-space:pre-wrap;word-wrap:break-word}code{background-color:#333;padding:2px 6px;border-radius:4px;font-family:monospace}strong{font-weight:bold}ul{margin:0;padding-left:20px}</style>
        </head><body>${formattedExplanation}</body></html>`;
}

// --- Main activation function ---
export function activate(context: vscode.ExtensionContext) {

    const commandHandler = async (promptGenerator: (languageId: string, selectedText: string, fullText: string, moduleName: string) => string, outputHandler: (editor: vscode.TextEditor, selection: vscode.Selection, responseText: string) => void) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showErrorMessage('No active editor found.'); return; }
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) { vscode.window.showErrorMessage('No code selected.'); return; }

        const apiKey = await getApiKey();
        if (!apiKey) {
            // User cancelled the API key process, so we stop here.
            return;
        }

        const fullText = editor.document.getText();
        const moduleName = path.parse(editor.document.fileName).name;

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "SnipSage is working...", cancellable: false }, async () => {
            try {
                const prompt = promptGenerator(editor.document.languageId, selectedText, fullText, moduleName);
                const responseText = await callGemini(prompt, apiKey);
                outputHandler(editor, selection, responseText);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to communicate with Gemini: ${error.message}`);
            }
        });
    };

    // --- Register Command 1: Explain Code (for Hover) ---
    const explainCommand = vscode.commands.registerCommand('snipsage.explainCode', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are an expert programmer. Explain ONLY the selected snippet using markdown for formatting.\n\nFULL FILE CONTENT:\n---\n${fullText}\n---\n\nSELECTED SNIPPET TO EXPLAIN:\n---\n${selectedText}\n---`,
            (editor, selection, explanation) => {
                lastExplainedRange = selection;
                lastExplanation = explanation;
                vscode.window.setStatusBarMessage('SnipSage: Explanation ready. Hover over the code to see it.', 5000);
            }
        );
    });

    // --- Register Command 2: Generate Unit Test ---
    const testCommand = vscode.commands.registerCommand('snipsage.generateTest', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are a testing expert. Write a unit test for the selected snippet from the module named '${moduleName}'. Use a common testing framework for the language. Return ONLY the code block for the test.\n\nFULL FILE CONTENT:\n---\n${fullText}\n---\n\nSELECTED SNIPPET TO TEST:\n---\n${selectedText}\n---`,
            async (editor, selection, testCode) => {
                const cleanedCode = testCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const originalPath = path.parse(editor.document.fileName);
                    const testFileName = `${originalPath.name}.test${originalPath.ext}`;
                    const testFileUri = vscode.Uri.joinPath(workspaceFolder.uri, testFileName);
                    try {
                        await vscode.workspace.fs.writeFile(testFileUri, new TextEncoder().encode(cleanedCode));
                        const doc = await vscode.workspace.openTextDocument(testFileUri);
                        await vscode.window.showTextDocument(doc);
                    } catch (error: any) { vscode.window.showErrorMessage(`Failed to create test file: ${error.message}`); }
                } else {
                    const doc = await vscode.workspace.openTextDocument({ content: cleanedCode, language: editor.document.languageId });
                    await vscode.window.showTextDocument(doc);
                }
            }
        );
    });

    // --- Register Command 3: Add Comments ---
    const commentCommand = vscode.commands.registerCommand('snipsage.addComments', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are a code commenting AI. Your ONLY job is to add inline comments to the provided code. Follow these rules strictly: 1. PRESERVE CODE: You must return the exact code you were given, character-for-character. Do not delete, add, or change any lines of code. 2. ADD COMMENTS: Add helpful, concise inline comments. 3. NO EXTRA TEXT: Your output must ONLY be the code with comments.\n\nFULL FILE CONTENT (for context):\n---\n${fullText}\n---\n\nCODE TO ADD COMMENTS TO:\n---\n${selectedText}\n---`,
            (editor, selection, commentedCode) => {
                const cleanedCode = commentedCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                editor.edit(editBuilder => { editBuilder.replace(selection, cleanedCode); });
            }
        );
    });

    // --- Register Command 4: Refactor Code ---
    const refactorCommand = vscode.commands.registerCommand('snipsage.refactorCode', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are an expert software architect. Your task is to refactor the selected code snippet to be more efficient, readable, and idiomatic for the ${languageId} language.\n- Use the full file content for context, but ONLY modify the selected snippet.\n- Return ONLY the refactored version of the selected snippet.\n- Do NOT add any explanations, docstrings, or markdown fences.\n\nFULL FILE CONTENT (for context):\n---\n${fullText}\n---\n\nCODE TO REFACTOR:\n---\n${selectedText}\n---`,
            (editor, selection, refactoredCode) => {
                const cleanedCode = refactoredCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                editor.edit(editBuilder => { editBuilder.replace(selection, cleanedCode); });
            }
        );
    });

    // --- Register Command 5: Generate Docstring ---
    const docstringCommand = vscode.commands.registerCommand('snipsage.generateDocstring', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are a technical writer. Your task is to generate a professional docstring for the selected function/class.\n- Use the full file content for context.\n- Use the standard docstring format for the ${languageId} language (e.g., Google-style for Python, JSDoc for JavaScript).\n- Return ONLY the original selected snippet, but with the new docstring added.\n- Do NOT add any other code, explanations, or markdown fences.\n\nFULL FILE CONTENT (for context):\n---\n${fullText}\n---\n\nCODE TO DOCUMENT:\n---\n${selectedText}\n---`,
            (editor, selection, documentedCode) => {
                const cleanedCode = documentedCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                editor.edit(editBuilder => { editBuilder.replace(selection, cleanedCode); });
            }
        );
    });

    // --- Register Command 6: Clear Cache ---
    const clearCacheCommand = vscode.commands.registerCommand('snipsage.clearCache', () => {
        lastExplainedRange = null;
        lastExplanation = null;
        vscode.window.setStatusBarMessage('SnipSage: Explanation cache cleared.', 5000);
    });
    
    // --- Register Command 7: Show Explanation in Panel ---
    const showInPanelCommand = vscode.commands.registerCommand('snipsage.showExplanationInPanel', () => {
        if (lastExplanation) { showExplanationInWebview(lastExplanation); }
    });

    // --- Register the Hover Provider ---
    const hoverProvider = vscode.languages.registerHoverProvider({ scheme: 'file', language: '*' }, {
        provideHover(document, position, token) {
            if (lastExplainedRange && lastExplanation && lastExplainedRange.contains(position)) {
                const commandUri = vscode.Uri.parse(`command:snipsage.showExplanationInPanel`);
                const markdownString = new vscode.MarkdownString(lastExplanation, true);
                markdownString.appendMarkdown(`\n\n---\n[Show in Panel](${commandUri})`);
                markdownString.isTrusted = true;
                return new vscode.Hover(markdownString, lastExplainedRange);
            }
            return null;
        }
    });

    context.subscriptions.push(explainCommand, testCommand, commentCommand, refactorCommand, docstringCommand, clearCacheCommand, showInPanelCommand, hoverProvider);
}

export function deactivate() {}