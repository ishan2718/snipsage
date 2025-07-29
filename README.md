# SnipSage: Your AI Code Assistant

<p align="center">
  <strong>
    Stuck on a complex piece of code? Need to write tests, refactor, or add documentation?  
    SnipSage brings the power of the Google Gemini API directly into your editor to help you code smarter, not harder.
  </strong>
</p>

---

## 💡 What is SnipSage?

Have you ever been dropped into a new codebase and felt completely lost? Or wished you had an assistant to handle the tedious parts of coding, like writing tests and documentation?

**SnipSage** is a Visual Studio Code extension that acts as your personal AI-powered assistant.  
It's designed to accelerate your workflow by helping you:
- Decipher complex code  
- Ensure code quality  
- Improve structure  

—all without ever leaving your editor.

---

## 🚀 Getting Started: 3 Easy Steps

### 1. Install the Extension  
Install SnipSage directly from the **[VS Code Marketplace](https://marketplace.visualstudio.com/)**.

### 2. Get Your API Key  
SnipSage is powered by the **Google Gemini API**. You'll need your own API key to use the extension.  
💡 You can get a free Gemini API key from [Google AI Studio](https://makersuite.google.com/app).

### 3. Set Your API Key  
When you run a SnipSage command for the first time, you'll be prompted to enter your API key.  
Paste it in once, and it will be securely saved for future use. That’s it!

---

## 🛠 Features: Your AI-Powered Toolkit

Once set up, use SnipSage's powerful features right from your editor.  
Just **select a block of code**, open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`), type `SnipSage`, and choose a command:

### 🧠 Explain Code  
Select a confusing function and run `SnipSage: Explain Selection`.  
An AI-generated explanation will appear on hover, with an option to open it in a side panel for more detail.

### ✅ Generate Unit Tests  
No more writing boilerplate test code.  
Select a function or class, run `SnipSage: Generate Unit Test`, and a test file will be created in your workspace with all the correct imports.

### 🔧 Refactor & Improve Code  
Select messy code and run `SnipSage: Refactor Selection`.  
Your code will be rewritten to be more efficient and readable, following best practices.

### 📝 Document Your Code  
- **Add Comments**: Use `SnipSage: Add Comments to Selection` to insert helpful inline comments.  
- **Generate Docstrings**: Use `SnipSage: Generate Docstring` to automatically create professional docstrings for functions and classes.

---

## 🧱 Built With

- [TypeScript](https://www.typescriptlang.org/) & [Node.js](https://nodejs.org/)
- [Visual Studio Code API](https://code.visualstudio.com/api)
- [Google Gemini API (gemini-2.0-flash)](https://ai.google.dev/)

---

## 🤝 Contributing

This is an open-source project, and contributions are always welcome!  
Feel free to fork the repo, make changes, and submit a pull request.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
