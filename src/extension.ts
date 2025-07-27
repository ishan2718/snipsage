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

// NEW: A simple cache to store explanations. Key: code snippet, Value: explanation.
const explanationCache = new Map<string, string>();

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
        // Clean up the response to remove markdown code block formatting
        return rawText.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
    } else {
        console.error('Unexpected API response structure:', result);
        throw new Error('Could not extract a valid response from the API.');
    }
}

// --- Main activation function ---
export function activate(context: vscode.ExtensionContext) {

    dotenv.config({ path: path.join(context.extensionPath, '.env') });

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

        const fullText = editor.document.getText();
        const moduleName = path.parse(editor.document.fileName).name;

        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            vscode.window.showErrorMessage('GEMINI_API_KEY not found. Please add it to your .env file in the project root.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "SnipSage is working...",
            cancellable: false
        }, async () => {
            try {
                const languageId = editor.document.languageId;
                const prompt = promptGenerator(languageId, selectedText, fullText, moduleName);
                const responseText = await callGemini(prompt, apiKey);
                outputHandler(editor, selection, responseText);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to communicate with Gemini: ${error.message}`);
            }
        });
    };

    // --- Register Command 1: Explain Code (UPDATED to cache the result) ---
    const explainCommand = vscode.commands.registerCommand('snipsage.explainCode', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are an expert programmer. A user has selected a snippet from a file. Use the full file content for context. Explain ONLY the selected snippet using markdown for formatting.

            FULL FILE CONTENT:
            ---
            ${fullText}
            ---
            
            SELECTED SNIPPET TO EXPLAIN:
            ---
            ${selectedText}
            ---`,
            (editor, selection, explanation) => {
                // Store the explanation in the cache with the selected text as the key
                explanationCache.set(editor.document.getText(selection), explanation);
                // Let the user know the explanation is ready for hover
                vscode.window.setStatusBarMessage('SnipSage: Explanation ready. Hover over the code to see it.', 5000);
            }
        );
    });

    // --- Register Command 2: Generate Unit Test ---
    const testCommand = vscode.commands.registerCommand('snipsage.generateTest', () => {
        commandHandler(
            (languageId, selectedText, fullText, moduleName) => `You are a testing expert. The user wants a unit test for a snippet from the module named '${moduleName}'. Use the full file content for context. Write a unit test for the selected snippet. When importing from the local module, use the name '${moduleName}'. Return ONLY the code block for the test.

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
                        await vscode.workspace.fs.writeFile(testFileUri, new TextEncoder().encode(testCode));
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
            (languageId, selectedText, fullText, moduleName) => `You are a code commenting AI. Your ONLY job is to add inline comments to the provided code. Follow these rules strictly: 1. PRESERVE CODE: You must return the exact code you were given, character-for-character. Do not delete, add, or change any lines of code. 2. ADD COMMENTS: Add helpful, concise inline comments. 3. NO EXTRA TEXT: Your output must ONLY be the code with comments.

            FULL FILE CONTENT (for context):
            ---
            ${fullText}
            ---

            CODE TO ADD COMMENTS TO:
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

    // --- NEW: Register the Hover Provider ---
    const hoverProvider = vscode.languages.registerHoverProvider('*', {
        provideHover(document, position, token) {
            // Iterate over all cached explanations
            for (const [codeSnippet, explanation] of explanationCache.entries()) {
                const fullText = document.getText();
                const snippetIndex = fullText.indexOf(codeSnippet);

                if (snippetIndex !== -1) {
                    const startPos = document.positionAt(snippetIndex);
                    const endPos = document.positionAt(snippetIndex + codeSnippet.length);
                    const range = new vscode.Range(startPos, endPos);

                    // Check if the current hover position is within the range of a cached snippet
                    if (range.contains(position)) {
                        const markdownString = new vscode.MarkdownString(explanation);
                        return new vscode.Hover(markdownString, range);
                    }
                }
            }
            return null; // No explanation found for this hover position
        }
    });

    context.subscriptions.push(explainCommand, testCommand, commentCommand, hoverProvider);
}

export function deactivate() {}