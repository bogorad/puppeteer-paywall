document
  .getElementById("duplicateBtn")
  .addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { action: "duplicateTab" },
      (response) => {
        if (response.success) {
          console.log(
            "Duplicated tab ID:",
            response.newTabId,
          );
        }
      },
    );
  });
