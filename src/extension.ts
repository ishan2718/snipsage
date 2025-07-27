import * as vscode from 'vscode';

// --- Define a type for the expected Gemini API response structure ---
// This tells TypeScript what the shape of the JSON object will be.
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

	// Clean up the response to remove markdown code block formatting
	const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
	if (rawText) {
		return rawText.replace(/```[\w\s]*\n/g, '').replace(/```/g, '').trim();
	} else {
		console.error('Unexpected API response structure:', result);
		throw new Error('Could not extract a valid response from the API.');
	}
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

		const apiKey = "AIzaSyBLvt6Cnyj5PePdjFU5Z69PziwkMQZey-o";
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

	// --- Register Command 1: Explain Code ---
	const explainCommand = vscode.commands.registerCommand('snipsage.explainCode', () => {
		commandHandler(
			(languageId, selectedText) => `You are an expert programmer. Explain the following snippet of ${languageId} code in a clear, concise way. Focus on the core logic and purpose:\n\n---\n${selectedText}\n---`,
			(editor, selection, explanation) => vscode.window.showInformationMessage(explanation, { modal: false })
		);
	});

	// --- Register Command 2: Generate Unit Test ---
	const testCommand = vscode.commands.registerCommand('snipsage.generateTest', () => {
		commandHandler(
			(languageId, selectedText) => `You are a testing expert. Given the following ${languageId} code, write a simple unit test for it. Use a common testing framework for the language (e.g., pytest for Python, Jest for JavaScript, JUnit for Java). Return ONLY the code block for the test, with no extra explanation.\n\n---\n${selectedText}\n---`,
			(editor, selection, testCode) => {
				vscode.workspace.openTextDocument({ content: testCode, language: editor.document.languageId })
					.then(doc => vscode.window.showTextDocument(doc));
			}
		);
	});

	// --- Register Command 3: Add Comments ---
	const commentCommand = vscode.commands.registerCommand('snipsage.addComments', () => {
		commandHandler(
			(languageId, selectedText) => `You are an expert programmer. Add concise, helpful inline comments to the following ${languageId} code where necessary to clarify the logic. Do not add comments for obvious code. Return the full, original code block with the new comments added.\n\n---\n${selectedText}\n---`,
			(editor, selection, commentedCode) => {
				editor.edit(editBuilder => {
					editBuilder.replace(selection, commentedCode);
				});
			}
		);
	});

	context.subscriptions.push(explainCommand, testCommand, commentCommand);
}