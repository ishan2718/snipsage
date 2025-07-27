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

// --- Function to get the API key from settings, or prompt the user if it doesn't exist ---
async function getApiKey(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('snipsage');
    let apiKey = config.get<string>('apiKey');

    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            prompt: 'Please enter your Google Gemini API Key',
            placeHolder: 'Enter your key here',
            ignoreFocusOut: true,
        });

        if (apiKey) {
            await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        }
    }
    return apiKey;
}

// --- Function to display explanation in a Webview Panel ---
function showExplanationInWebview(explanation: string) {
    const panel = vscode.window.createWebviewPanel(
        'snipSageExplanation', 
        'SnipSage Explanation', 
        vscode.ViewColumn.Beside, 
        {} 
    );

    const formattedExplanation = explanation
        .replace(/```([\w\s]*)\n([\s\S]*?)```/g, (match, lang, code) => `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^\* (.*$)/gm, '<ul><li>$1</li></ul>')
        .replace(/\n/g, '<br>');

    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SnipSage Explanation</title>
            <style>
                body { background-color: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; padding: 20px; line-height: 1.6; }
                pre { background-color: #252526; padding: 1em; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word; }
                code { background-color: #333; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; }
                strong { font-weight: bold; }
                ul { margin: 0; padding-left: 20px; }
            </style>
        </head>
        <body>
            ${formattedExplanation}
        </body>
        </html>
    `;
}

// --- Main activation function ---
export function activate(context: vscode.ExtensionContext) {

    const commandHandler = async (promptGenerator: (languageId: string, selectedText: string, fullText: string, moduleName: string) => string, outputHandler: (editor: vscode.TextEditor, selection: vscode.Selection, responseText: string) => void) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { 
            vscode.window.showErrorMessage('No active editor found.');
            return; 
        }
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) { 
            vscode.window.showErrorMessage('No code selected.');
            return; 
        }

        const apiKey = await getApiKey();
        if (!apiKey) {
            vscode.window.showErrorMessage('SnipSage requires a Gemini API key to function.');
            return;
        }

        const fullText = editor.document.getText();
        const moduleName = path.parse(editor.document.fileName).name;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "SnipSage is working...",
            cancellable: false
        }, async () => {
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
            (languageId, selectedText, fullText, moduleName) => `You are an expert programmer. A user has selected a snippet from a file. Use the full file content for context. Explain ONLY the selected snippet using markdown for formatting.\n\nFULL FILE CONTENT:\n---\n${fullText}\n---\n\nSELECTED SNIPPET TO EXPLAIN:\n---\n${selectedText}\n---`,
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
            (languageId, selectedText, fullText, moduleName) => `You are a testing expert...`, // This prompt is long, keeping it abbreviated for clarity
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
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to create test file: ${error.message}`);
                    }
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
            (languageId, selectedText, fullText, moduleName) => `You are a code commenting AI...`, // This prompt is long, keeping it abbreviated for clarity
            (editor, selection, commentedCode) => {
                const cleanedCode = commentedCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, cleanedCode);
                });
            }
        );
    });
    
    // --- Register Command 4: Show Explanation in Panel ---
    const showInPanelCommand = vscode.commands.registerCommand('snipsage.showExplanationInPanel', () => {
        if (lastExplanation) {
            showExplanationInWebview(lastExplanation);
        }
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

    context.subscriptions.push(explainCommand, testCommand, commentCommand, showInPanelCommand, hoverProvider);
}

export function deactivate() {}