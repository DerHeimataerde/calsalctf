let typedKeys = "";

// Event listener for keypress to detect the sequence
document.addEventListener("keydown", (event) => {
  if (event.key === "Shift") return; // Ignore Shift keys

  const key = event.key.toLowerCase();
  typedKeys += key;

  // Normalize the typed sequence (remove spaces and keep last 20 characters)
  const normalizedTypedKeys = typedKeys.replace(/\s+/g, "").slice(-20);

  // Validate the sequence when it reaches 20 characters
  if (normalizedTypedKeys.length === 20) {
    fetch("/validate-sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: normalizedTypedKeys }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.valid) {
          // Dynamically insert passkey input into the page when the correct 20-character sequence is entered
          if (!document.getElementById("passkey-container")) {
            document.body.insertAdjacentHTML(
              "beforeend",
              `<div id="passkey-container" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
               background: rgba(0, 0, 0, 0.8); padding: 20px; border-radius: 10px; text-align: center; z-index: 2;">
                <p style="color: white;">Every adventure requires a:</p>
                <form action="/validate-passkey" method="POST">
                  <input type="text" id="passkey" name="passkey" placeholder="Type here" autocomplete="off">
                  <button type="submit">Submit</button>
                </form>
                <p id="result-message"></p>
              </div>`
            );
          }

          const passkeyInput = document.getElementById("passkey");
          passkeyInput.value = "";
          passkeyInput.focus();
        }
      })
      .catch((error) => {
        console.error("Error validating sequence:", error);
      });
  }
});
