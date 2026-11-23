// Firebase Storage Manager - إدارة التخزين المختلط
// يعمل مع Firebase Firestore أو LocalStorage كبديل

// Configuration constants
const CONFIG = {
  STORAGE_KEYS: {
    PHONES: 'phones',
    ACCESSORIES: 'accessories',
    SALES: 'sales',
    PHONE_TYPES: 'phone_types',
    ACCESSORY_CATEGORIES: 'accessory_categories',
    CURRENT_USER: 'current_user'
  }
};

// Default data
const DEFAULT_PHONE_TYPES = {
  "Apple": ["iPhone 13", "iPhone 14", "iPhone 15"],
  "Samsung": ["S22", "S23", "S24"],
  "Xiaomi": ["Redmi Note 12", "Mi 11"]
};

const DEFAULT_ACCESSORY_CATEGORIES = [
  { name: 'accessory', arabic_name: 'إكسسوار', description: 'إكسسوارات عامة' },
  { name: 'charger', arabic_name: 'شاحن', description: 'شواحن الهواتف' },
  { name: 'case', arabic_name: 'غلاف', description: 'أغلفة الهواتف' },
  { name: 'screen_protector', arabic_name: 'حماية الشاشة', description: 'حماية شاشة الهاتف' },
  { name: 'cable', arabic_name: 'كابل', description: 'كابلات البيانات والشحن' },
  { name: 'headphone', arabic_name: 'سماعات', description: 'سماعات الهواتف' },
  { name: 'other', arabic_name: 'أخرى', description: 'فئات أخرى' }
];

// ===== معرّف إكسسوار قصير قابل للمسح على ملصق 40x25mm =====
// الصيغة 9XXXXXXX (8 أرقام): رقم فقط يقرأه الماسح بسهولة، ويبدأ بـ 9
// ليتمايز عن أرقام الهواتف. نحتفظ بالصيغة القديمة ACCXXXXX حتى تبقى
// الملصقات التي طُبعت سابقاً قابلة للمسح.

function normalizeAccessoryCode(value) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  return String(value ?? '').trim()
    .replace(/[٠-٩]/g, d => arabicDigits.indexOf(d))
    .replace(/[۰-۹]/g, d => persianDigits.indexOf(d))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function shortAccessoryId(seed) {
  const normalized = normalizeAccessoryCode(seed);
  // الباركود المخصص قد لا يحتوي أي رمز أبجدي رقمي، لذا نجزّئ النص الخام أيضاً
  const text = normalized || String(seed ?? '').trim();
  if (!text) return '';
  // بصمة 64 بت من تابعَي تجزئة مستقلين، ثم سبعة أرقام بعد البادئة 9
  let h1 = 2166136261;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2246822519) >>> 0;
  }
  const value = ((BigInt(h1) << 32n) | BigInt(h2)) % 10000000n;
  return `9${value.toString().padStart(7, '0')}`;
}

function isShortAccessoryId(value) {
  const code = normalizeAccessoryCode(value);
  return /^9\d{7}$/.test(code) || /^ACC[0-9A-Z]{5}$/.test(code);
}

function accessoryScannableId(accessory) {
  if (!accessory) return '';
  const stored = accessory.barcode_id;
  if (isShortAccessoryId(stored)) return normalizeAccessoryCode(stored);
  // السجلات القديمة تحمل ACC-YYYYMMDD-0001 في barcode_id؛ نشتق لها معرّفاً ثابتاً
  // من هذا الرقم نفسه (لا من الاسم/السعر) حتى لا يتغيّر المعرّف بتعديل بيانات السجل.
  return shortAccessoryId(accessory.barcode_id || accessory.barcode || accessory.serial_number || accessory.sku || accessory.id);
}

function accessoryCodeCandidates(accessory) {
  if (!accessory) return [];
  const values = [
    accessory.barcode_id, accessory.barcode, accessory.sku,
    accessory.accessory_number, accessory.serial_number,
    accessoryScannableId(accessory)
  ];
  // الأكواد المخصصة التي يزيلها التنظيف (مثل ###) تُطابق نصها الخام
  const normalized = values.map(normalizeAccessoryCode).filter(Boolean);
  const raw = values.map(v => String(v ?? '').trim())
    .filter(v => v && !normalizeAccessoryCode(v));
  return [...new Set([...normalized, ...raw])];
}

function accessoryMatchesCode(accessory, code) {
  const needle = normalizeAccessoryCode(code);
  const target = needle || String(code ?? '').trim();
  return !!target && accessoryCodeCandidates(accessory).includes(target);
}

const accessoryCode = {
  normalize: normalizeAccessoryCode,
  shortId: shortAccessoryId,
  isShort: isShortAccessoryId,
  scannableId: accessoryScannableId,
  candidates: accessoryCodeCandidates,
  matches: accessoryMatchesCode
};

if (typeof window !== 'undefined') window.accessoryCode = accessoryCode;

class FirebaseStorageManager {
  constructor() {
    this.firebaseDB = window.firebaseDatabase;
    this.isFirebaseAvailable = !!(this.firebaseDB && this.firebaseDB.db);
    
    if (this.isFirebaseAvailable) {
      console.log('🔥 Firebase Storage Manager initialized with Firebase');
    } else {
      console.log('💾 Firebase not available, using LocalStorage fallback');
      this.initializeLocalStorage();
    }
  }

  /**
   * Initialize localStorage fallback
   */
  initializeLocalStorage() {
    // Initialize default data if not exists
    if (!this.getPhoneTypes()) {
      this.setPhoneTypes(DEFAULT_PHONE_TYPES);
    }

    if (!this.getAccessoryCategories()) {
      this.setAccessoryCategories(DEFAULT_ACCESSORY_CATEGORIES);
    }

    if (!this.getPhones()) {
      this.setPhones([]);
    }

    if (!this.getAccessories()) {
      this.setAccessories([]);
    }

    if (!this.getSales()) {
      this.setSales([]);
    }
  }

  /**
   * Generic storage methods
   */
  setItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Error saving to localStorage:', error);
      return false;
    }
  }

  getItem(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return defaultValue;
    }
  }

  removeItem(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('Error removing from localStorage:', error);
      return false;
    }
  }

  /**
   * Phone management
   */
  async getPhones() {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.getPhones();
      } catch (error) {
        console.error('Error getting phones from Firebase:', error);
        return this.getItem(CONFIG.STORAGE_KEYS.PHONES, []);
      }
    }
    return this.getItem(CONFIG.STORAGE_KEYS.PHONES, []);
  }

  async setPhones(phones) {
    if (this.isFirebaseAvailable) {
      console.log('Firebase mode: phones are managed individually');
      return true;
    }
    return this.setItem(CONFIG.STORAGE_KEYS.PHONES, phones);
  }

  async addPhone(phone) {
    if (this.isFirebaseAvailable) {
      try {
        phone.date_added = new Date();
        const phoneId = await this.firebaseDB.addPhone(phone);
        return phoneId;
      } catch (error) {
        console.error('Error adding phone to Firebase:', error);
        if (
          this.firebaseDB &&
          typeof this.firebaseDB.isQuotaExceededError === 'function' &&
          this.firebaseDB.isQuotaExceededError(error) &&
          typeof this.firebaseDB.addPhoneDirect === 'function'
        ) {
          try {
            console.warn('⚠️ Firebase read quota hit while saving phone. Retrying direct Firestore write.');
            return await this.firebaseDB.addPhoneDirect(phone);
          } catch (directError) {
            console.error('Error adding phone directly to Firebase:', directError);
          }
        }
        return false;
      }
    }
    
    // LocalStorage fallback
    const phones = this.getPhones();
    phone.id = this.generateId();
    phone.date_added = new Date().toISOString();
    phones.push(phone);
    return this.setPhones(phones);
  }

  async addPhoneDirect(phone) {
    if (this.isFirebaseAvailable && typeof this.firebaseDB.addPhoneDirect === 'function') {
      try {
        phone.date_added = new Date();
        return await this.firebaseDB.addPhoneDirect(phone);
      } catch (error) {
        console.error('Error adding phone directly to Firebase:', error);
        return false;
      }
    }

    return this.addPhone(phone);
  }

  async updatePhone(phoneId, updatedPhone) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.updatePhone(phoneId, updatedPhone);
        return true;
      } catch (error) {
        console.error('Error updating phone in Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const phones = this.getPhones();
    const index = phones.findIndex(p => p.id === phoneId);
    if (index !== -1) {
      phones[index] = { ...phones[index], ...updatedPhone };
      return this.setPhones(phones);
    }
    return false;
  }

  async deletePhone(phoneId) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.deletePhone(phoneId);
        return true;
      } catch (error) {
        console.error('Error deleting phone from Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const phones = this.getPhones();
    const filteredPhones = phones.filter(p => p.id !== phoneId);
    return this.setPhones(filteredPhones);
  }

  async getPhoneByNumber(phoneNumber) {
    const phones = await this.getPhones();
    return phones.find(p => p.phone_number === phoneNumber);
  }

  async getPhoneBySerial(serialNumber) {
    const phones = await this.getPhones();
    return phones.find(p => p.serial_number === serialNumber);
  }

  /**
   * Accessory management
   */
  async getAccessories() {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.getAccessories();
      } catch (error) {
        console.error('Error getting accessories from Firebase:', error);
        return this.getItem(CONFIG.STORAGE_KEYS.ACCESSORIES, []);
      }
    }
    return this.getItem(CONFIG.STORAGE_KEYS.ACCESSORIES, []);
  }

  // يطابق المعرّف القصير والباركود المرجعي القديم وأي حقل معرّف آخر
  async getAccessoryByBarcode(code) {
    const target = normalizeAccessoryCode(code) || String(code ?? '').trim();
    if (!target) return null;
    const all = await this.getAccessories();
    const list = Array.isArray(all) ? all : Object.values(all || {});
    return list.find(a => accessoryMatchesCode(a, target)) || null;
  }

  async setAccessories(accessories) {
    if (this.isFirebaseAvailable) {
      console.log('Firebase mode: accessories are managed individually');
      return true;
    }
    return this.setItem(CONFIG.STORAGE_KEYS.ACCESSORIES, accessories);
  }

  async addAccessory(accessory) {
    console.log('📦 Storage Manager: محاولة إضافة أكسسوار:', accessory);
    
    if (this.isFirebaseAvailable) {
      try {
        console.log('🔥 Storage Manager: Firebase متاح، إرسال إلى Firebase...');
        accessory.date_added = new Date();
        const accessoryId = await this.firebaseDB.addAccessory(accessory);
        console.log('✅ Storage Manager: تم إضافة الأكسسوار في Firebase، ID:', accessoryId);
        return accessoryId;
      } catch (error) {
        console.error('❌ Storage Manager: خطأ في إضافة الأكسسوار إلى Firebase:', error);
        return false;
      }
    }
    
    console.log('💾 Storage Manager: Firebase غير متاح، حفظ في localStorage...');
    // LocalStorage fallback
    const accessories = this.getAccessories();
    accessory.id = this.generateId();
    accessory.date_added = new Date().toISOString();
    accessories.push(accessory);
    const result = this.setAccessories(accessories);
    console.log('✅ Storage Manager: تم حفظ الأكسسوار في localStorage');
    return result;
  }

  async updateAccessory(accessoryId, updatedAccessory) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.updateAccessory(accessoryId, updatedAccessory);
        return true;
      } catch (error) {
        console.error('Error updating accessory in Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const accessories = this.getAccessories();
    const index = accessories.findIndex(a => a.id === accessoryId);
    if (index !== -1) {
      accessories[index] = { ...accessories[index], ...updatedAccessory };
      return this.setAccessories(accessories);
    }
    return false;
  }

  async deleteAccessory(accessoryId) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.deleteAccessory(accessoryId);
        return true;
      } catch (error) {
        console.error('Error deleting accessory from Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const accessories = this.getAccessories();
    const filteredAccessories = accessories.filter(a => a.id !== accessoryId);
    return this.setAccessories(filteredAccessories);
  }

  /**
   * Sales management
   */
  async getSales() {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.getSales();
      } catch (error) {
        console.error('Error getting sales from Firebase:', error);
        return this.getItem(CONFIG.STORAGE_KEYS.SALES, []);
      }
    }
    return this.getItem(CONFIG.STORAGE_KEYS.SALES, []);
  }

  async setSales(sales) {
    if (this.isFirebaseAvailable) {
      console.log('Firebase mode: sales are managed individually');
      return true;
    }
    return this.setItem(CONFIG.STORAGE_KEYS.SALES, sales);
  }

  async addSale(sale) {
    if (this.isFirebaseAvailable) {
      try {
        sale.date_created = new Date();
        const saleId = await this.firebaseDB.addSale(sale);
        return saleId;
      } catch (error) {
        console.error('Error adding sale to Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const sales = this.getSales();
    sale.id = this.generateId();
    sale.date_created = new Date().toISOString();
    sales.push(sale);
    return this.setSales(sales);
  }

  async updateSale(saleId, updatedSale) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.updateSale(saleId, updatedSale);
        return true;
      } catch (error) {
        console.error('Error updating sale in Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const sales = this.getSales();
    const index = sales.findIndex(s => s.id === saleId);
    if (index !== -1) {
      sales[index] = { ...sales[index], ...updatedSale };
      return this.setSales(sales);
    }
    return false;
  }

  /**
   * تحديث حالة توفر Firebase قبل عملية حساسة (الاسترجاع).
   * لا يغيّر سلوك باقي الدوال التي تستخدم isFirebaseAvailable.
   */
  refreshFirebaseAvailability() {
    this.isFirebaseAvailable = !!(this.firebaseDB && this.firebaseDB.db);
    return this.isFirebaseAvailable;
  }

  // تسلسل محلي عبر Web Locks إن توفّرت (يمنع استرجاعين متزامنين من تبويبين)
  async _withReturnLock(saleId, work) {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      return await navigator.locks.request('return-sale:' + saleId, work);
    }
    return await work();
  }

  /**
   * استرجاع الفاتورة: في Firebase تُنفّذ العملية كاملة داخل معاملة ذرّية،
   * وفي الوضع المحلي تُحسب الكميات في الذاكرة ثم تُكتب المجموعتان معاً.
   * لا تبتلع الأخطاء أبداً في هذا المسار.
   */
  async returnSale(saleId, returnedAt) {
    if (this.refreshFirebaseAvailability()) {
      if (typeof this.firebaseDB.returnSale !== 'function') {
        throw new Error('دالة الاسترجاع الذرّي غير متاحة في قاعدة البيانات');
      }
      return await this.firebaseDB.returnSale(saleId, returnedAt);
    }

    return await this._withReturnLock(saleId, async () => {
      const sales = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SALES) || '[]');
      const saleIndex = Array.isArray(sales) ? sales.findIndex(s => s && s.id === saleId) : -1;
      if (saleIndex === -1) {
        throw new Error('الفاتورة غير موجودة في قاعدة البيانات، حدّث الصفحة وأعد المحاولة');
      }

      const sale = sales[saleIndex];
      if (sale.returned === true || sale.status === 'مسترجعة') {
        return { alreadyReturned: true, restocked: [], skipped: [] };
      }

      const rawAccessories = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ACCESSORIES) || '[]');
      const accessories = Array.isArray(rawAccessories) ? rawAccessories.map(a => ({ ...a })) : [];
      const totals = new Map();
      const skipped = [];
      const returnedValue = returnedAt || new Date().toISOString();

      // حساب كل الكميات الجديدة في الذاكرة أولاً — لا كتابة قبل اكتمال الحساب
      for (const item of (Array.isArray(sale.items) ? sale.items : [])) {
        if (!item || item.type === 'phone') continue;
        const rawId = item.id != null ? String(item.id) : '';
        const index = accessories.findIndex(a => a && (
          String(a.id) === rawId || String(a.sku) === rawId ||
          String(a.barcode) === rawId || String(a.accessory_number) === rawId
        ));
        if (!rawId || index === -1) {
          skipped.push({ id: rawId, reason: 'الأكسسوار غير موجود في مجموعة accessories' });
          continue;
        }
        const qty = Math.max(0, Number(item.quantity) || 0);
        const existing = totals.get(index);
        if (existing) {
          existing.qty += qty;
        } else {
          totals.set(index, { qty, name: accessories[index].name || item.name || rawId });
        }
      }

      const restocked = [];
      for (const [index, { qty, name }] of totals) {
        const accessory = accessories[index];
        const currentStock = Number(accessory.quantity_in_stock ?? accessory.quantity ?? 0) || 0;
        const newStock = currentStock + qty;
        accessory.quantity_in_stock = newStock;
        accessory.quantity = newStock;
        accessory.updatedAt = new Date().toISOString();
        restocked.push({ id: accessory.id, name, added: qty });
      }

      sales[saleIndex] = {
        ...sale,
        returned: true,
        status: 'مسترجعة',
        returned_at: returnedValue,
        updatedAt: new Date().toISOString()
      };

      // localStorage لا يعرف المعاملات: نكتب المخزون أولاً ثم الفاتورة،
      // ونرجّع المخزون إذا فشلت كتابة الفاتورة كي لا يحدث إرجاع بلا تعليم.
      const previousAccessories = localStorage.getItem(CONFIG.STORAGE_KEYS.ACCESSORIES);
      try {
        if (!this.setItem(CONFIG.STORAGE_KEYS.ACCESSORIES, accessories)) {
          throw new Error('تعذر حفظ مخزون الأكسسوارات محلياً');
        }
        if (!this.setItem(CONFIG.STORAGE_KEYS.SALES, sales)) {
          throw new Error('تعذر حفظ الفاتورة محلياً');
        }
      } catch (error) {
        try {
          if (previousAccessories === null) {
            localStorage.removeItem(CONFIG.STORAGE_KEYS.ACCESSORIES);
          } else {
            localStorage.setItem(CONFIG.STORAGE_KEYS.ACCESSORIES, previousAccessories);
          }
        } catch (rollbackError) {
          console.error('⚠️ تعذّر ترجيع المخزون بعد فشل الحفظ:', rollbackError);
        }
        throw error;
      }

      return { alreadyReturned: false, restocked, skipped };
    });
  }

  async deleteSale(saleId) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.deleteSale(saleId);
        return true;
      } catch (error) {
        console.error('Error deleting sale from Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const sales = this.getSales();
    const filteredSales = sales.filter(s => s.id !== saleId);
    return this.setSales(filteredSales);
  }

  async getSaleById(saleId) {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.getSale(saleId);
      } catch (error) {
        console.error('Error getting sale from Firebase:', error);
        return null;
      }
    }
    
    const sales = this.getSales();
    return sales.find(s => s.id === saleId);
  }

  /**
   * Phone Types management
   */
  async getPhoneTypes() {
    if (this.isFirebaseAvailable) {
      try {
        console.log('🔄 Storage Manager: تحميل أنواع الهواتف من Firebase...');
        const phoneTypes = await this.firebaseDB.getPhoneTypes();
        console.log('📱 Storage Manager: أنواع الهواتف المحملة:', phoneTypes);
        
        // Convert array to object format for compatibility with existing code
        const phoneTypesObj = {};
        phoneTypes.forEach(type => {
          const manufacturer = type.manufacturer || type.brand; // Support both field names
          if (!phoneTypesObj[manufacturer]) {
            phoneTypesObj[manufacturer] = [];
          }
          phoneTypesObj[manufacturer].push(type.model);
        });
        console.log('🏭 Storage Manager: البيانات المحولة:', phoneTypesObj);
        return phoneTypesObj;
      } catch (error) {
        console.error('❌ Storage Manager: خطأ في تحميل أنواع الهواتف من Firebase:', error);
        return this.getItem(CONFIG.STORAGE_KEYS.PHONE_TYPES);
      }
    }
    console.log('💾 Storage Manager: Firebase غير متاح، تحميل من localStorage...');
    return this.getItem(CONFIG.STORAGE_KEYS.PHONE_TYPES);
  }

  async setPhoneTypes(phoneTypes) {
    if (this.isFirebaseAvailable) {
      console.log('Firebase mode: phone types are managed individually');
      return true;
    }
    return this.setItem(CONFIG.STORAGE_KEYS.PHONE_TYPES, phoneTypes);
  }

  async addPhoneType(brand, model) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.addPhoneType({ brand, model });
        return true;
      } catch (error) {
        console.error('Error adding phone type to Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const phoneTypes = this.getPhoneTypes() || {};
    if (!phoneTypes[brand]) {
      phoneTypes[brand] = [];
    }
    if (!phoneTypes[brand].includes(model)) {
      phoneTypes[brand].push(model);
      return this.setPhoneTypes(phoneTypes);
    }
    return false;
  }

  async deletePhoneType(brand, model) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.deletePhoneType(brand, model);
        return true;
      } catch (error) {
        console.error('Error deleting phone type from Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const phoneTypes = this.getPhoneTypes() || {};
    if (phoneTypes[brand]) {
      phoneTypes[brand] = phoneTypes[brand].filter(m => m !== model);
      if (phoneTypes[brand].length === 0) {
        delete phoneTypes[brand];
      }
      return this.setPhoneTypes(phoneTypes);
    }
    return false;
  }

  /**
   * Accessory Categories management
   */
  async getAccessoryCategories() {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.getAccessoryCategories();
      } catch (error) {
        console.error('Error getting accessory categories from Firebase:', error);
        return this.getItem(CONFIG.STORAGE_KEYS.ACCESSORY_CATEGORIES);
      }
    }
    return this.getItem(CONFIG.STORAGE_KEYS.ACCESSORY_CATEGORIES);
  }

  async setAccessoryCategories(categories) {
    if (this.isFirebaseAvailable) {
      console.log('Firebase mode: accessory categories are managed individually');
      return true;
    }
    return this.setItem(CONFIG.STORAGE_KEYS.ACCESSORY_CATEGORIES, categories);
  }

  async addAccessoryCategory(category) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.addAccessoryCategory(category);
        return true;
      } catch (error) {
        console.error('Error adding accessory category to Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const categories = this.getAccessoryCategories() || [];
    const exists = categories.find(c => c.name === category.name || c.arabic_name === category.arabic_name);
    if (!exists) {
      categories.push(category);
      return this.setAccessoryCategories(categories);
    }
    return false;
  }

  async deleteAccessoryCategory(categoryName) {
    if (this.isFirebaseAvailable) {
      try {
        await this.firebaseDB.deleteAccessoryCategory(categoryName);
        return true;
      } catch (error) {
        console.error('Error deleting accessory category from Firebase:', error);
        return false;
      }
    }
    
    // LocalStorage fallback
    const categories = this.getAccessoryCategories() || [];
    const filteredCategories = categories.filter(c => c.arabic_name !== categoryName);
    return this.setAccessoryCategories(filteredCategories);
  }

  /**
   * User management
   */
  getCurrentUser() {
    return this.getItem(CONFIG.STORAGE_KEYS.CURRENT_USER);
  }

  setCurrentUser(user) {
    return this.setItem(CONFIG.STORAGE_KEYS.CURRENT_USER, user);
  }

  logout() {
    return this.removeItem(CONFIG.STORAGE_KEYS.CURRENT_USER);
  }

  isLoggedIn() {
    return !!this.getCurrentUser();
  }

  /**
   * Search functionality
   */
  async searchPhones(searchTerm) {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.searchPhones(searchTerm);
      } catch (error) {
        console.error('Error searching phones in Firebase:', error);
        return [];
      }
    }
    
    // LocalStorage fallback
    const phones = await this.getPhones();
    return phones.filter(phone => {
      const searchFields = [
        phone.phone_number,
        phone.serial_number,
        phone.brand,
        phone.model,
        phone.phone_color,
        phone.phone_memory,
        phone.description,
        phone.customer_name,
        phone.customer_id
      ];
      
      return searchFields.some(field => 
        field && field.toString().toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }

  async searchAccessories(searchTerm) {
    if (this.isFirebaseAvailable) {
      try {
        return await this.firebaseDB.searchAccessories(searchTerm);
      } catch (error) {
        console.error('Error searching accessories in Firebase:', error);
        return [];
      }
    }
    
    // LocalStorage fallback
    const accessories = await this.getAccessories();
    return accessories.filter(accessory => {
      const searchFields = [
        accessory.name,
        accessory.category,
        accessory.description,
        accessory.supplier,
        accessory.notes
      ];
      
      return searchFields.some(field => 
        field && field.toString().toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }

  /**
   * Real-time listeners (Firebase only)
   */
  onPhonesChange(callback) {
    if (this.isFirebaseAvailable) {
      return this.firebaseDB.onPhonesChange(callback);
    }
    console.log('Real-time listeners only available with Firebase');
    return null;
  }

  onAccessoriesChange(callback) {
    if (this.isFirebaseAvailable) {
      return this.firebaseDB.onAccessoriesChange(callback);
    }
    console.log('Real-time listeners only available with Firebase');
    return null;
  }

  onSalesChange(callback) {
    if (this.isFirebaseAvailable) {
      return this.firebaseDB.onSalesChange(callback);
    }
    console.log('Real-time listeners only available with Firebase');
    return null;
  }

  /**
   * Utility methods
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Export/Import functionality
   */
  async exportData() {
    const data = {
      phones: await this.getPhones(),
      accessories: await this.getAccessories(),
      sales: await this.getSales(),
      phoneTypes: await this.getPhoneTypes(),
      accessoryCategories: await this.getAccessoryCategories(),
      exportDate: new Date().toISOString(),
      version: '2.0',
      firebaseEnabled: this.isFirebaseAvailable
    };
    return JSON.stringify(data, null, 2);
  }

  async importData(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.phones) {
        for (const phone of data.phones) {
          await this.addPhone(phone);
        }
      }
      if (data.accessories) {
        for (const accessory of data.accessories) {
          await this.addAccessory(accessory);
        }
      }
      if (data.sales) {
        for (const sale of data.sales) {
          await this.addSale(sale);
        }
      }
      if (data.phoneTypes) {
        for (const [brand, models] of Object.entries(data.phoneTypes)) {
          for (const model of models) {
            await this.addPhoneType(brand, model);
          }
        }
      }
      if (data.accessoryCategories) {
        for (const category of data.accessoryCategories) {
          await this.addAccessoryCategory(category);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error importing data:', error);
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    const phones = await this.getPhones();
    const accessories = await this.getAccessories();
    const sales = await this.getSales();
    const phoneTypes = await this.getPhoneTypes();
    const accessoryCategories = await this.getAccessoryCategories();

    return {
      phones: phones.length,
      accessories: accessories.length,
      sales: sales.length,
      phoneTypes: Object.keys(phoneTypes || {}).length,
      accessoryCategories: (accessoryCategories || []).length,
      firebaseEnabled: this.isFirebaseAvailable
    };
  }
}

// إنشاء instance واحد للاستخدام في جميع أنحاء التطبيق
const storage = new FirebaseStorageManager();

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.storage = storage;
  window.FirebaseStorageManager = FirebaseStorageManager;
}

// Make available globally for non-module usage
window.FirebaseStorageManager = FirebaseStorageManager;
window.storage = storage;

// Also export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FirebaseStorageManager, storage };
}
