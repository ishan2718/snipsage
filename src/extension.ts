import * as vscode from 'vscode';
// NEW: Import the 'dotenv' package to read the .env file
import * as dotenv from 'dotenv';
// NEW: Import the 'path' package to help locate the .env file
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

// --- Function to display explanation in a Webview Panel ---
function showExplanationInWebview(explanation: string) {
    const panel = vscode.window.createWebviewPanel(
        'snipSageExplanation', 
        'SnipSage Explanation', 
        vscode.ViewColumn.Beside, 
        {} 
    );

    const formattedExplanation = explanation.replace(/\n/g, '<br>');

    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SnipSage Explanation</title>
            <style>
                body { background-color: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; padding: 20px; line-height: 1.6; }
                code { background-color: #333; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; }
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

    // NEW: Configure dotenv to find the .env file in the project root
    // context.extensionPath gives the root directory of your extension
    dotenv.config({ path: path.join(context.extensionPath, '.env') });

    const commandHandler = async (promptGenerator: (languageId: string, selectedText: string, fullText: string) => string, outputHandler: (editor: vscode.TextEditor, selection: vscode.Selection, responseText: string) => void) => {
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

        // UPDATED: Read the API key from the environment variables loaded by dotenv
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
                const prompt = promptGenerator(languageId, selectedText, fullText);
                const responseText = await callGemini(prompt, apiKey);
                outputHandler(editor, selection, responseText);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to communicate with Gemini: ${error.message}`);
            }
        });
    };

    // --- Register Command 1: Explain Code ---
    const explainCommand = vscode.commands.registerCommand('snipsage.explainCode', () => {
        commandHandler(
            (languageId, selectedText, fullText) => `You are an expert programmer. A user has selected a snippet from a file. Use the full file content for context. Explain ONLY the selected snippet.

            FULL FILE CONTENT:
            ---
            ${fullText}
            ---
            
            SELECTED SNIPPET TO EXPLAIN:
            ---
            ${selectedText}
            ---`,
            (editor, selection, explanation) => showExplanationInWebview(explanation)
        );
    });

    // --- Register Command 2: Generate Unit Test ---
    const testCommand = vscode.commands.registerCommand('snipsage.generateTest', () => {
        commandHandler(
            (languageId, selectedText, fullText) => `You are a testing expert. Use the full file content for context and write a unit test for the selected snippet. Use a common testing framework for the language (e.g., pytest for Python, Jest for JavaScript). Return ONLY the code block for the test.

            FULL FILE CONTENT:
            ---
            ${fullText}
            ---

            SELECTED SNIPPET TO TEST:
            ---
            ${selectedText}
            ---`,
            (editor, selection, testCode) => {
                const cleanedCode = testCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                vscode.workspace.openTextDocument({ content: cleanedCode, language: editor.document.languageId })
                    .then(doc => vscode.window.showTextDocument(doc));
            }
        );
    });

    // --- Register Command 3: Add Comments ---
    const commentCommand = vscode.commands.registerCommand('snipsage.addComments', () => {
        commandHandler(
            (languageId, selectedText, fullText) => `You are an expert programmer. Use the full file content for context. Add concise, helpful inline comments ONLY to the selected snippet. Return the full code of the selected snippet with comments added.

            FULL FILE CONTENT:
            ---
            ${fullText}
            ---

            SELECTED SNIPPET TO COMMENT:
            ---
            ${selectedText}
            ---`,
            (editor, selection, commentedCode) => {
                const cleanedCode = commentedCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, commentedCode);
                });
            }
        );
    });

    context.subscriptions.push(explainCommand, testCommand, commentCommand);
}

export function deactivate() {}