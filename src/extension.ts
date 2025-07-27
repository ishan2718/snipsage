import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
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

// A simpler cache to store the last explained range and its explanation.
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
        return rawText.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
    } else {
        console.error('Unexpected API response structure:', result);
        throw new Error('Could not extract a valid response from the API.');
    }
}

// --- NEW: Function to get the API key from settings, or prompt the user if it doesn't exist ---
async function getApiKey(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('snipsage');
    let apiKey = config.get<string>('apiKey');

    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            prompt: 'Please enter your Google Gemini API Key',
            placeHolder: 'Enter your key here',
            ignoreFocusOut: true, // Keep the box open even if the user clicks away
        });

        if (apiKey) {
            // Save the key to the global settings for future use
            await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        }
    }
    return apiKey;
}

// --- Main activation function ---
export function activate(context: vscode.ExtensionContext) {

    dotenv.config({ path: path.join(context.extensionPath, '.env') });

    // This command handler is used for all commands.
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

        // Get the API key, prompting the user if necessary.
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
                // Store the range and the explanation for the hover provider.
                lastExplainedRange = selection;
                lastExplanation = explanation;
                vscode.window.setStatusBarMessage('SnipSage: Explanation ready. Hover over the code to see it.', 5000);
            }
        );
    });

    // --- Register Command 2: Generate Unit Test ---
    const testCommand = vscode.commands.registerCommand('snipsage.generateTest', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are a testing expert. The user wants a unit test for a snippet from the module named '${moduleName}'.
            Use the full file content for context. Write a unit test for the selected snippet.
            When importing from the local module, use the name '${moduleName}'. For example: 'from ${moduleName} import YourClass'.
            Use a common testing framework for the language (e.g., pytest for Python, Jest for JavaScript).
            Return ONLY the code block for the test.

            FULL FILE CONTENT:
            ---
            ${fullText}
            ---

            SELECTED SNIPPET TO TEST:
            ---
            ${selectedText}
            ---`,
            async (editor, selection, testCode) => {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

                if (workspaceFolder) {
                    const originalPath = path.parse(editor.document.fileName);
                    const testFileName = `${originalPath.name}.test${originalPath.ext}`;
                    const testFileUri = vscode.Uri.joinPath(workspaceFolder.uri, testFileName);

                    try {
                        const contentBytes = new TextEncoder().encode(testCode);
                        await vscode.workspace.fs.writeFile(testFileUri, contentBytes);
                        
                        const doc = await vscode.workspace.openTextDocument(testFileUri);
                        await vscode.window.showTextDocument(doc);
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to create test file: ${error.message}`);
                    }
                } else {
                    const doc = await vscode.workspace.openTextDocument({ content: testCode, language: editor.document.languageId });
                    await vscode.window.showTextDocument(doc);
                }
            }
        );
    });

    // --- Register Command 3: Add Comments ---
    const commentCommand = vscode.commands.registerCommand('snipsage.addComments', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are a code commenting AI. Your ONLY job is to add inline comments to the provided code.
Follow these rules strictly:
1.  **PRESERVE CODE:** You must return the exact code you were given, character-for-character. Do not delete, add, or change any lines of code. This includes imports, blank lines, and existing formatting.
2.  **ADD COMMENTS:** Add helpful, concise inline comments to explain complex or non-obvious parts of the code.
3.  **NO EXTRA TEXT:** Your output must ONLY be the code with comments. Do not include any explanations, greetings, or markdown code fences like \`\`\`.

Here is the full file for context, but do not modify it:
---
${fullText}
---

Here is the specific code you must add comments to. Remember to return this exact code, plus your comments:
---
${selectedText}
---`,
            (editor, selection, commentedCode) => {
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, commentedCode);
                });
            }
        );
    });

    // --- Register the Hover Provider ---
    const hoverProvider = vscode.languages.registerHoverProvider({ scheme: 'file', language: '*' }, {
        provideHover(document, position, token) {
            // Check if there is a cached explanation and if the hover position is within its range.
            if (lastExplainedRange && lastExplanation && lastExplainedRange.contains(position)) {
                const markdownString = new vscode.MarkdownString(lastExplanation);
                return new vscode.Hover(markdownString, lastExplainedRange);
            }
            return null;
        }
    });

    context.subscriptions.push(explainCommand, testCommand, commentCommand, hoverProvider);
}

export function deactivate() {}