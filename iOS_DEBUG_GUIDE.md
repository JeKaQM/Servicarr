# iOS Login Debugging - What to Look For

## Backend Logs (Terminal where app runs)

When you try to login on iOS, watch the terminal for these logs:

```
=== LOGIN REQUEST START ===
Method: POST, Path: /api/login
IP: [device-IP]
User-Agent: [will show Safari/iOS info]
Username attempt: [your-username]
[then one of the following...]

AUTH SUCCESS: [username]
=== LOGIN SUCCESS ===
```

OR if it fails:

```
DECODE ERROR: [error message]           → JSON parsing failed
AUTH FAILED: Wrong username...           → Username didn't match
AUTH FAILED: Wrong password...           → Password didn't match
IP BLOCKED: [IP]                         → Too many attempts
```

**Key insight:** If you don't see `=== LOGIN REQUEST START ===`, the iOS device never sent the request.

---

## Browser Console Logs (Safari DevTools on iOS)

When you try to login on iOS, look in the console for:

```
submitLogin called
Username: admin Password length: 8
CSRF token: [first 10 chars]...
Attempting login...
[FETCH] Starting: /api/login
[FETCH] Options: {cache: 'no-store', credentials: 'include', signal: AbortSignal, ...}
[FETCH] Response received for /api/login: status=200, ok=true
[FETCH] Body parsed for /api/login: {ok: true}
[FETCH] Success for /api/login: {ok: true}
Login successful, response: {ok: true}
Closing dialog
Calling whoami after login
```

**OR if it fails:**

```
[FETCH] Error for /api/login: Error: HTTP 401
[FETCH] Error status: 401
Login error: Error: HTTP 401
```

---

## Common Issues to Diagnose

### Issue 1: Request Never Sent
**Symptoms:** 
- No `=== LOGIN REQUEST START ===` in backend logs
- No `[FETCH] Response received...` in browser console

**Possible causes:**
- JavaScript error preventing fetch
- Network issue
- Browser blocked the request
- CORS issue

**Debug:** Look for red errors in console before login attempt

---

### Issue 2: Request Sent But Gets Stuck
**Symptoms:**
- `[FETCH] Starting: /api/login` appears
- Button says "Logging in..." forever
- Never see `[FETCH] Response received...`

**Possible causes:**
- Server hung or not responding
- Network timeout
- AbortController not working on iOS
- 10-second timeout too short

**Debug:** 
- Check if backend received request (`=== LOGIN REQUEST START ===`)
- Wait 10+ seconds - should see error message "Request timeout"

---

### Issue 3: Successful Request But Login Fails
**Symptoms:**
- Backend shows `AUTH SUCCESS: admin`
- Frontend shows error message

**Possible causes:**
- Session cookie not being set
- Session cookie not being sent back

**Debug:**
- Try logging in on Mac Safari - does it work?
- Check if session cookie appears in iOS Safari Storage tab

---

### Issue 4: Response Received But Stuck on "Logging in..."
**Symptoms:**
- `[FETCH] Response received for /api/login: status=200, ok=true`
- But then nothing happens
- Button stays disabled

**Possible causes:**
- Error in whoami() after login
- Modal.close() not working
- JavaScript error in login flow

**Debug:** Look for error messages after "Closing dialog" log

---

## Test Steps on iOS

1. **Open Safari DevTools:**
   - On Mac: Safari → Develop → [iPhone name] → your page
   
2. **Open Console tab**
   
3. **Try login with credentials: admin / [your-password]**
   
4. **Watch for logs and capture the FIRST error or stuck point**

5. **Take screenshot of console**

6. **Take screenshot of backend terminal logs**

7. **Report what you see**

---

## Network Tab Inspection

In Safari DevTools Network tab:

1. **Look for `/api/login` request**

2. **Check Request tab:**
   - Headers: Should have `X-CSRF-Token: [token]`
   - Headers: Should have `Content-Type: application/json`
   - Payload: Should show `{"username":"admin","password":"..."}`

3. **Check Response tab:**
   - Status: Should be `200 OK`
   - Body: Should show `{"ok":true}`

4. **Check Cookies tab:**
   - Should have `sess` cookie after successful login
   - Should have `csrf` cookie before and after

---

## Potential iOS-Specific Issues

### Issue: Virtual Keyboard Blocks Form
**Sign:** Button says "Logging in..." but nothing happens
**Fix:** Already handled with viewport settings and 90vh dialog height

### Issue: Touch Event Not Firing
**Sign:** Button click doesn't submit form
**Fix:** Already have both `click` and `touchstart` listeners with `preventDefault()`

### Issue: Credentials Not Included in Fetch
**Sign:** Backend doesn't see cookies
**Fix:** Already using `credentials: 'include'` in fetch options

### Issue: Response Body Can't Be Read Twice
**Sign:** Fetch succeeds but result is undefined
**Fix:** Now handling response body parsing more carefully in j()

---

## Quick Diagnostic Command

Add this to Safari console to check CSRF token:

```javascript
// Check if CSRF cookie exists
console.log('CSRF Cookie:', document.cookie);
console.log('CSRF Function:', getCsrf());

// Try a test fetch
fetch('/api/me', {credentials: 'include'})
  .then(r => r.json())
  .then(d => console.log('Test fetch result:', d))
  .catch(e => console.error('Test fetch error:', e));
```

---

## What to Tell Me

When you encounter an issue, collect:

1. **Backend terminal output** - Copy paste all logs from login attempt
2. **Browser console output** - Screenshot or copy paste
3. **Description** - What the button says and whether it ever changes
4. **Device** - iPhone model, iOS version, Safari version
5. **Network** - Are you on WiFi or cellular?

---

## Summary

The app now has detailed logging at every step:

- ✅ Frontend logs every fetch step
- ✅ Backend logs every part of login process
- ✅ Better error messages
- ✅ Improved response body handling for iOS

**Next step:** Test on iOS and share the logs you see!

