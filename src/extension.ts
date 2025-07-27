import * as vscode from 'vscode';

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
        // Return the raw markdown text
        return rawText;
    } else {
        console.error('Unexpected API response structure:', result);
        throw new Error('Could not extract a valid response from the API.');
    }
}

// --- NEW: Function to display explanation in a Webview Panel ---
function showExplanationInWebview(explanation: string) {
    // Create a new webview panel
    const panel = vscode.window.createWebviewPanel(
        'snipSageExplanation', // Identifies the type of the webview. Used internally
        'SnipSage Explanation', // Title of the panel displayed to the user
        vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
        {} // Webview options.
    );

    // Replace markdown newlines with HTML line breaks for proper rendering
    const formattedExplanation = explanation.replace(/\n/g, '<br>');

    // Set the HTML content for the webview
    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SnipSage Explanation</title>
            <style>
                body {
                    background-color: #1e1e1e;
                    color: #d4d4d4;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    padding: 20px;
                    line-height: 1.6;
                }
                code {
                    background-color: #333;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'Courier New', Courier, monospace;
                }
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

    const commandHandler = async (promptGenerator: (languageId: string, selectedText: string) => string, outputHandler: (editor: vscode.TextEditor, selection: vscode.Selection, responseText: string) => void) => {
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

        const apiKey = "AIzaSyBLvt6Cnyj5PePdjFU5Z69PziwkMQZey-o"; // <--- PASTE YOUR GEMINI API KEY HERE
        if (!apiKey) {
            vscode.window.showErrorMessage('SnipSage API key is not set. Please add it in the extension.ts file.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "SnipSage is working...",
            cancellable: false
        }, async () => {
            try {
                const languageId = editor.document.languageId;
                const prompt = promptGenerator(languageId, selectedText);
                const responseText = await callGemini(prompt, apiKey);
                outputHandler(editor, selection, responseText);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to communicate with Gemini: ${error.message}`);
            }
        });
    };

    // --- Register Command 1: Explain Code (Updated to use Webview) ---
    const explainCommand = vscode.commands.registerCommand('snipsage.explainCode', () => {
        commandHandler(
            (languageId, selectedText) => `You are an expert programmer. Explain the following snippet of ${languageId} code in a clear, concise way. Focus on the core logic and purpose. Use markdown for formatting like code blocks and bold text.\n\n---\n${selectedText}\n---`,
            // UPDATED: Call the new webview function instead of showInformationMessage
            (editor, selection, explanation) => showExplanationInWebview(explanation)
        );
    });

    // --- Register Command 2: Generate Unit Test ---
    const testCommand = vscode.commands.registerCommand('snipsage.generateTest', () => {
        commandHandler(
            (languageId, selectedText) => `You are a testing expert. Given the following ${languageId} code, write a simple unit test for it. Use a common testing framework for the language (e.g., pytest for Python, Jest for JavaScript, JUnit for Java). Return ONLY the code block for the test, with no extra explanation.\n\n---\n${selectedText}\n---`,
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
            (languageId, selectedText) => `You are an expert programmer. Add concise, helpful inline comments to the following ${languageId} code where necessary to clarify the logic. Do not add comments for obvious code. Return the full, original code block with the new comments added.\n\n---\n${selectedText}\n---`,
            (editor, selection, commentedCode) => {
                const cleanedCode = commentedCode.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, cleanedCode);
                });
            }
        );
    });

    context.subscriptions.push(explainCommand, testCommand, commentCommand);
}