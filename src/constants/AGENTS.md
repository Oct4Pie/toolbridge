# Constants - Agent Work Log

**Purpose**: Tracks autonomous agent refactoring work on constants and shared definitions.

**Parent**: See `/AGENTS.md` for project-wide principles and overall status.

---

## 🎯 Module Responsibility

The constants layer provides:
- License texts (Apache License 2.0, etc.)
- API format constants
- Shared enumerations
- Global constants

**SSOT Principles**:
- All license text routes through `licenses.ts`
- All format constants defined once
- All shared enums centralized

---

## Session: License Text Extraction (2025-01-06)

**Objective**: Extract embedded license text from `modelService.ts` to create SSOT for license constants.

### Problem

**Before**: Embedded 197-line Apache License 2.0 text bloating the file

```typescript
// modelService.ts (lines 24-220)
const APACHE_LICENSE_TEXT = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/
[... 197 lines of license text ...]`;
```

**Violations**:
- ❌ 197 lines of license text embedded in service file
- ❌ Violated DRY principle (license should be centralized)
- ❌ File 195% over 300-line limit (585 vs 300)

### Solution

Created `src/constants/licenses.ts` as SSOT for all license text constants:

```typescript
// src/constants/licenses.ts (217 lines)

/**
 * License Texts - Single Source of Truth
 *
 * Centralized license text constants used across the codebase.
 * Import from this file instead of embedding license text directly.
 */

export const APACHE_LICENSE_TEXT = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
   ...
`;

// Add other licenses here as needed
```

Updated `modelService.ts` to import from SSOT:

```typescript
// modelService.ts
import { APACHE_LICENSE_TEXT } from '../constants/licenses.js';

// Now references the SSOT constant
```

### Impact

- ✅ Lines removed from modelService.ts: 197
- ✅ New file size: 391 lines (30% under limit) ✅
- ✅ SSOT compliance: Single source for license constants
- ✅ DRY compliance: No duplication of license text
- ✅ Reusable across entire codebase

### SSOT/DRY/KISS Compliance

**SSOT**: ✅
- Created `constants/licenses.ts` as SSOT for license text
- All files must now import from this central location

**DRY**: ✅
- Eliminated 197 lines of duplicate license text
- License can now be updated in one place

**KISS**: ✅
- Simple constants file
- Clear organization
- Easy to add new licenses

---

## Available Constants

### License Texts

**File**: `licenses.ts` (217 lines)

```typescript
import { APACHE_LICENSE_TEXT } from '../constants/licenses.js';

// Use in generated files, model cards, etc.
const modelCard = {
  license: APACHE_LICENSE_TEXT,
  // ...
};
```

---

## Usage Guidelines

### Importing License Text

```typescript
import { APACHE_LICENSE_TEXT } from '../constants/licenses.js';

// Use in model responses
const licenseInfo = {
  text: APACHE_LICENSE_TEXT,
  spdx: 'Apache-2.0'
};

// Use in generated documentation
const docs = `
License:
${APACHE_LICENSE_TEXT}
`;
```

---

## Best Practices

### DO

✅ **Always import from `constants/licenses.ts`**:
```typescript
import { APACHE_LICENSE_TEXT } from '../constants/licenses.js';
```

✅ **Add new licenses to this file**:
```typescript
// constants/licenses.ts
export const MIT_LICENSE_TEXT = `...`;
export const GPL_LICENSE_TEXT = `...`;
```

### DON'T

❌ **Don't embed license text inline**:
```typescript
// WRONG - creates duplication
const license = `Apache License Version 2.0...`;

// RIGHT - import from SSOT
import { APACHE_LICENSE_TEXT } from '../constants/licenses.js';
```

❌ **Don't create separate license files**:
```typescript
// WRONG - scatters license management
// src/licenses/apache.ts
// src/licenses/mit.ts

// RIGHT - centralize in constants
// src/constants/licenses.ts (all licenses)
```

---

## Adding New Constants

When adding new shared constants:

1. **Add to appropriate file in `src/constants/`**
2. **Export with clear JSDoc documentation**
3. **Use descriptive constant names (UPPER_SNAKE_CASE)**
4. **Update this AGENTS.md with usage examples**
5. **Remove any inline duplicates from other files**

**Example**:
```typescript
// src/constants/licenses.ts

/**
 * MIT License text
 * @see https://opensource.org/licenses/MIT
 */
export const MIT_LICENSE_TEXT = `MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
...`;
```

---

**Status**: ✅ **COMPLETE** - License Text Extraction

**Last Updated**: 2025-01-06
**Files Created**: 1 (`licenses.ts`)
**Files Modified**: 1 (`modelService.ts`)
**Lines Extracted**: 197
**DRY Violations Fixed**: 1 (license text duplication)
