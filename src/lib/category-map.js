/**
 * category-map.js — NGUỒN DUY NHẤT cho ánh xạ danh mục kho V2 (web demo).
 *
 * Production (server.js), cấu hình bộ lọc (/api/shopv2/config) và bài test
 * (_test/category.test.js) ĐỀU require module này — không còn bảng/hàm lặp
 * lệch nhau nữa. Toàn bộ bảng dựa trên dữ liệu THẬT kho V2 (731k sp), không tự bịa.
 */
'use strict';

// --- 1) Danh mục CON: category (zh) -> nhãn tiếng Việt (nguồn PDP/apiSrc) ---
const CAT_VI = {
  'POLO/T恤/上衣': 'Áo polo / Áo thun / Áo',
  '上衣': 'Áo',
  '休闲/运动鞋': 'Giày thể thao',
  '其他': 'Phụ kiện khác',
  '凉鞋/拖鞋': 'Dép / Sandal',
  '单肩包/斜挎包': 'Túi đeo vai / Túi chéo',
  '卫衣/针织衫': 'Áo hoodie / Áo len',
  '商务正装鞋': 'Giày công sở',
  '围巾/丝巾': 'Khăn choàng / Khăn lụa',
  '大衣/羽绒服': 'Áo khoác dài / Áo phao',
  '太阳镜': 'Kính râm',
  '夹克/外套': 'Áo khoác / Jacket',
  '套装': 'Bộ đồ',
  '帽子': 'Mũ',
  '平底鞋/便鞋': 'Giày bệt',
  '手拿包/迷你包': 'Túi xách tay / Túi mini',
  '手提包': 'Túi xách tay',
  '泳装': 'Đồ bơi',
  '牛仔裤': 'Quần jean',
  '皮带/腰带': 'Thắt lưng',
  '短裤': 'Quần short',
  '衬衫': 'Áo sơ mi',
  '裙装': 'Váy / Chân váy',
  '裤装': 'Quần dài',
  '钥匙包/钥匙扣': 'Ví chìa khóa / Móc khóa',
  '钱包': 'Ví',
  '靴子/高帮鞋': 'Bốt / Giày cổ cao',
  '首饰': 'Trang sức',
  '高跟鞋': 'Giày cao gót',
  '眼镜/镜架': 'Mắt kính / Gọng kính',
};

// --- 2) Danh mục CON: listItem.categoryName (EN, giá trị thật 44 loại kho V2) -> nhãn VI ---
const CAT_VI_EN = {
  'Tops': 'Áo',
  'Sweaters/Knitwear': 'Áo len / Áo dệt kim',
  'Dresses/Skirts': 'Váy / Chân váy',
  'Pants': 'Quần dài',
  'Polo/T-shirts': 'Áo polo / Áo thun',
  'Jackets/Blazers': 'Áo khoác / Blazer',
  'Shirts': 'Áo sơ mi',
  'Jeans': 'Quần jean',
  'Shorts': 'Quần short',
  'Skirts/Dress': 'Váy / Chân váy',
  'Suits/Jumpsuits': 'Bộ đồ / Jumpsuit',
  'Beachwear': 'Đồ bơi',
  'Underwear/Homewear': 'Đồ lót / Đồ ở nhà',
  'Jackets/Outfits': 'Áo khoác / Bộ trang phục',
  'Winter coats': 'Áo khoác mùa đông',
  'Sneakers': 'Giày thể thao',
  'Sandals/Flip Flops': 'Dép / Sandal',
  'Boots/Hi-tops': 'Bốt / Giày cổ cao',
  'Highheels': 'Giày cao gót',
  'Flat': 'Giày bệt',
  'Wedges/Flatforms': 'Giày đế xuồng',
  'Business casual shoes': 'Giày công sở',
  'Business formal shoes': 'Giày công sở trang trọng',
  'Shoulder/Crossbody Bags': 'Túi đeo vai / Túi chéo',
  'Purses': 'Túi xách',
  'Clutch-bags': 'Túi cầm tay',
  'Shoulder/Messenger Bags': 'Túi đeo chéo / Túi messenger',
  'Backpacks': 'Ba lô',
  'Bags': 'Túi',
  'Top handles': 'Túi quai xách',
  'Travel bags': 'Túi du lịch',
  'Trolley cases': 'Vali kéo',
  'Makeup bags': 'Túi trang điểm',
  'Wallets': 'Ví',
  'Jewelry': 'Trang sức',
  'Belts': 'Thắt lưng',
  'Hats': 'Mũ',
  'Scarves': 'Khăn choàng',
  'Sun glasses/Frames': 'Kính râm / Gọng kính',
  'Sun glasses': 'Kính râm',
  'Ties': 'Cà vạt',
  'Gloves': 'Găng tay',
  'Key bags/Keychains': 'Ví chìa khóa / Móc khóa',
  'Others': 'Phụ kiện khác',
};

// --- 3) Nhóm khách hàng / giới tính: category1 (zh) -> token EN ổn định cho bộ lọc ---
const GENDER_ZH_TO_EN = {
  '女士': 'Women',   // Nữ
  '男士': 'Men',     // Nam
  '男女同款': 'Unisex',
  '女童': 'Girls',   // Bé gái
  '男童': 'Boys',    // Bé trai
  '婴儿': 'Infant',  // Em bé
};

// --- 4) Nhãn tiếng Việt của token EN (đồng bộ bộ lọc + breadcrumb + PDP) ---
const DEPT_VI = {
  'Women': 'Nữ', 'Men': 'Nam', 'Kids': 'Trẻ em',
  'Girls': 'Bé gái', 'Boys': 'Bé trai', 'Infant': 'Em bé',
  'Unisex': 'Unisex',
};

// --- 5) Nhóm chính (category2 zh) -> nhãn VI cho cây 2 chiều ---
const CAT2_ZH = { '服装': 'Quần áo', '鞋履': 'Giày dép', '包袋': 'Túi xách', '配饰': 'Phụ kiện' };

// --- 6) Ánh xạ dùng chung cho mapItemCategory ---
// Danh mục con: ưu tiên EN name, rồi zh category, rồi token
function resolveCatVi(enName, zhCat) {
  if (enName && CAT_VI_EN[enName]) return CAT_VI_EN[enName];
  if (zhCat && CAT_VI[zhCat]) return CAT_VI[zhCat];
  return '';
}

// --- 7) HÀM PRODUCTION: map category của 1 item kho V2 (dùng trong server.js v2MapItem) ---
function mapItemCategory(p) {
  const li = p.listItem || {};
  const catNameEn = li.categoryName || '';
  const zhCat = p.category || '';
  const zhCat1 = String(p.category1 || '').trim();
  // nhóm khách hàng / giới tính
  const gTok = GENDER_ZH_TO_EN[zhCat1] || '';
  // ghép chuỗi hiển thị (ưu tiên: gTok, EN name, zh category, token)
  const catSegs = [];
  const seenCat = {};
  const pushCat = (s) => { s = String(s || '').trim(); if (s && !seenCat[s]) { seenCat[s] = 1; catSegs.push(s); } };
  if (gTok && !catSegs.includes(gTok)) catSegs.unshift(gTok);
  pushCat(catNameEn);
  pushCat(zhCat);
  (Array.isArray(p.categoryToken) ? p.categoryToken : []).forEach(pushCat);
  const category = catSegs.join(' / ');
  // Nhãn VI: ưu tiên EN name, Hán category, rồi fallback từ token EN (fix 21/09 lưu
  // categoryToken EN thay vì Hán — api.dev giờ trả token EN; nhãn vẫn ra được).
  let label = resolveCatVi(catNameEn, zhCat);
  if (!label) {
    const tokens = Array.isArray(p.categoryToken) ? p.categoryToken : [];
    for (const t of tokens) {
      const v = CAT_VI_EN[String(t).trim()];
      if (v) { label = v; break; }
    }
  }
  const deptVi = DEPT_VI[gTok] || '';
  return {
    category,
    categoryToken: catSegs.length ? catSegs : (Array.isArray(p.categoryToken) ? p.categoryToken : []),
    category1: gTok,
    category2: String(p.category2 || '').trim(),
    categoryName: catNameEn,
    categoryEn: catNameEn,
    category_vi: label,
    dept: gTok,
    dept_vi: deptVi,
  };
}

module.exports = {
  CAT_VI, CAT_VI_EN, GENDER_ZH_TO_EN, DEPT_VI, CAT2_ZH,
  resolveCatVi, mapItemCategory, realTypes: Object.keys(CAT_VI_EN),
};
