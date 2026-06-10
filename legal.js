const siteInfo = window.SHICI_SITE_INFO || {};
const owner = siteInfo.ownerName || "备案主体待填写";
const email = siteInfo.contactEmail || "";
const icpNumber = siteInfo.icpNumber || "";

document.querySelector("#legalOwner").textContent = owner;

const emailElement = document.querySelector("#legalEmail");
emailElement.textContent = email || "待填写";
if (email) emailElement.href = `mailto:${email}`;

const icpElement = document.querySelector("#legalIcp");
icpElement.textContent = icpNumber || "备案完成后公示";
