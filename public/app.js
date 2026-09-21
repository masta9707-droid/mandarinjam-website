/* ============ MANDARIN JAM — mandarinjam.club (chưa mở thanh toán thật) ============ */
'use strict';

// CATALOG-R1 B.6 (20/9): V2 là catalog MẶC ĐỊNH của /shop + search (738k) — bỏ gate mj_feed/🧪.
// lot1 (280 SPU) chỉ còn là data legacy cho đơn cũ; không phải feed shop.
window.__MJ_FEED__ = 'v2';

const PAGE_SIZE = 24;
const CART_KEY = 'mj.guest.cart.v1';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/* ---------------- money ---------------- */
// CATALOG-R1 §4D: USD là giá chính + tiền thanh toán ở MỌI locale.
// VND chỉ là dòng tham khảo — chỉ hiện khi có FX nguồn thật (hiện FX_REFERENCE_PENDING → ẩn).
function fmtUSD(v){
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return 'US$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Badge giảm giá: chỉ khi pair sale+reference hợp lệ, cùng SKU/currency, % trong 1–99.
// reference<=sale / missing / zero / currency khác → null (ẩn cả gạch ngang lẫn badge).
function discountPct(saleUsd, refUsd){
  const s = Number(saleUsd), r = Number(refUsd);
  if (!Number.isFinite(s) || !Number.isFinite(r) || s <= 0 || r <= s) return null;
  const pct = Math.round((1 - s / r) * 100);
  if (!Number.isFinite(pct) || pct < 1 || pct > 99) return null;
  return pct;
}
function fmtVND(v){ return new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' ₫'; }

/* ---- Giá bán theo brief §7.1 (chốt 19/9): vốn = CNY × 4.000 (số cố định chống trượt),
   giá = vốn × hệ số biên theo tier brand, TRÒN XUỐNG đơn vị 10.000₫.
   Không dùng số đổi tiền trôi trong payload kho. ---- */
const CNY_HEDGE_RATE = 4000; // 4.000 theo brief (ky phap VN = bon nghin)
const MARGIN_A = 1.13, MARGIN_B = 1.15, MARGIN_C = 1.20, MARGIN_DEF = 1.15, MARGIN_CAP = 1.25;
// Tier short (de tranh: dung word-boundary) / tier dài (khớp substring, an toan)
const BRANDS_A_WORD = ['mm6','off-white','off white'];
const BRANDS_A_SUB = ['prada','miu miu','moncler','mm6 margiela','mugler','moschino','missoni'];
const BRANDS_B = ['max mara','ralph lauren','proenza schouler','pinko','norma kamali','misbhv','rag & bone','rag and bone'];
const BRANDS_C_WORD = ['mk'];
const BRANDS_C_SUB = ['oakley','oliver peoples','michael kors','neous','p.a.r.o.s.h','parosh'];
function hasWord(n, w){ return new RegExp('(?<![a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(n); }
function brandMargin(brand){
  const n = String(brand || '').trim().toLowerCase();
  if (!n) return MARGIN_DEF;
  if (BRANDS_A_WORD.some(w => hasWord(n, w)) || BRANDS_A_SUB.some(b => n.includes(b))) return MARGIN_A;
  if (BRANDS_B.some(b => n.includes(b))) return MARGIN_B;
  if (BRANDS_C_WORD.some(w => hasWord(n, w)) || BRANDS_C_SUB.some(b => n.includes(b))) return MARGIN_C;
  return MARGIN_DEF;
}
function priceVND(cny, brand){
  const marginInt = Math.min(Math.round(brandMargin(brand) * 100), MARGIN_CAP * 100); // 113/115/120/125
  // Toan phan nguyen chong loi float: raw = cny * 4000 * marginInt / 100 (khong nhay 27.6M->27.59M)
  const numerator = (Number(cny || 0) * CNY_HEDGE_RATE * marginInt) / 100;
  return Math.floor(numerator / 10000) * 10000;
}

/* ============ W2.6 — NGÔN NGỮ 4 CHẾ ĐỘ (vi mặc định — UIUX-R1 P1b) ============
   LANG: vi | en | zh | ko. Đọc từ ?lang= (URL share giữ ngôn ngữ), fallback VI
   (shop Việt Nam, niêm yết VND — UIUX-R1: chuyển mặc định EN->VI cho bản Việt nhất quán).
   Invalid/missing lang -> VI. t(key, ctx): lấy chuỗi UI theo ngôn ngữ hiện tại. */
let LANG = (new URLSearchParams(location.search).get('lang') || 'vi');
if (!['vi','en','zh','ko'].includes(LANG)) LANG = 'vi';
// helper: gắn lang hợp lệ (kể cả VI) vào path nội bộ khi cần share/giữ ngôn ngữ
function urlLang(path){
  const u = new URL(path, location.origin);
  u.searchParams.set('lang', LANG);
  return u.pathname + u.search + u.hash;
}
const LANGS = ['vi','en','zh','ko'];
const LANG_LABEL = {vi:'Tiếng Việt', en:'English', zh:'中文', ko:'한국어'};
const LANG_FLAG = {vi:'🇻🇳', en:'🇬🇧', zh:'🇨🇳', ko:'🇰🇷'};
const T = {
  vi: { shop:'Cửa hàng', home:'Trang chủ', cart:'Giỏ hàng', checkout:'Thanh toán', co_name:'Họ và tên', co_phone:'Số điện thoại', co_addr:'Địa chỉ nhận hàng', co_note:'Ghi chú (không bắt buộc)', co_next:'Tiếp tục →', co_back:'Quay lại', co_cod:'Thanh toán khi nhận hàng', co_review:'Xác nhận đơn', co_pay:'Thanh toán', co_done:'Cảm ơn bạn! Đã nhận đơn.', co_done_sub:'Quýt đã nhận đơn và đang xét duyệt để bảo đảm an toàn thanh toán. Theo dõi trạng thái — cũng nhớ kiểm tra app + email (kể cả spam).', co_track:'Theo dõi đơn', co_order:'Đơn hàng', co_notfound:'Không tìm thấy đơn này.', co_req_name:'Vui lòng nhập họ tên.', co_req_phone:'Số điện thoại chưa hợp lệ.', co_promo:'Mã ưu đãi web', co_apply:'Áp dụng', co_disc:'Giảm giá', co_group:'Nhận ưu đãi tiếp + cập nhật hàng mới trong nhóm Zalo Mandarin Jam.', co_group_btn:'Vào nhóm Zalo', co_promo_ok:'Đã áp dụng mã', co_promo_bad:'Không có mã này.', co_promo_empty:'Nhập mã ưu đãi.', co_card_soon:'Thanh toán thẻ sẽ mở sau (đang chuẩn bị)', co_usd_note:'Món kho mới tính bằng USD — thanh toán thẻ (USD) đang được chuẩn bị, chưa thể đặt ngay. Món cũ (VND) vẫn đặt COD bình thường.', co_usd_no_cod:'Giỏ có món kho mới tính bằng USD — chưa thể đặt COD. Xin vui lòng chờ thanh toán thẻ mở, hoặc đặt riêng các món cũ (VND).', addToCart:'Thêm vào giỏ', buyNow:'Mua ngay', askQuyt:'Hỏi Quýt', outOfStock:'Hết hàng tạm thời', emptyCart:'Giỏ hàng của bạn đang trống', emptyCartCta:'Tiếp tục xem sản phẩm', shopHeading:'Sản phẩm', showMore:'Hiển thị thêm', itemsLeft:'món còn lại', sizes:'size', outStock:'Hết hàng',matchedSku:'SKU khớp:', category:'Danh mục', breadcrumbHome:'Trang chủ', delivery:'Giao ước tính', about:'Về chúng tôi', commitment:'Cam kết', legal:'Điều khoản & Chính sách', priceAsk:'Giá liên hệ', search:'Tìm kiếm', sort:'Sắp xếp', country:'Việt Nam', applyOrder:'Đặt hàng', editCart:'Chỉnh sửa giỏ', shippingTo:'Giao tới', subtotal:'Tạm tính', total:'Tổng cộng', source:'nguồn gốc', rate:'tỷ giá',
    nav_shop:'Cửa hàng', nav_about:'Về Mandarin Jam', nav_commit:'Cam kết', nav_support:'Hỗ trợ', hero_title:'Khám phá phong cách của bạn.', hero_sub:'Thời trang và phụ kiện từ nhiều thương hiệu, cùng sự hỗ trợ tận tâm của Quýt.', cta_shop:'Xem cửa hàng', cta_shop_hero:'Xem sản phẩm', cta_order:'Tư vấn cùng Quýt', featured_head:'Sản phẩm nổi bật', featured_more:'Xem tất cả', home_support_title:'Cần thêm thông tin?', home_support_body:'Cần tư vấn về sản phẩm hoặc kích cỡ? Quýt sẵn sàng hỗ trợ bạn.', search_ph:'Tìm thương hiệu, sản phẩm hoặc SKU', home_social:'Vẫn là Mandarin Jam bạn quen. Cần hỗ trợ, cứ <a href="https://zalo.me/3481730554380561086" target="_blank" rel="noopener">nhắn Quýt</a>.', home_contact:'Cần chọn nhanh hơn? Nhắn Quýt để được tư vấn ngay.', grid_loading:'Đang tải sản phẩm…', commit_kicker:'Vì sao chọn Mandarin Jam', commit_head:'Cam kết của Quýt', commit_price_h:'Giá minh bạch', commit_price_p:'Giá niêm yết bằng VND, rõ ràng, không giá ảo.', commit_auth_h:'Hàng chính hãng', commit_auth_p:'Mỗi món đều có mã sản phẩm riêng, đối chiếu được với chứng từ kiểm chứng.', commit_del_h:'Giao đúng hẹn', commit_del_p:'Giao dự kiến 1–8 tuần theo chính sách vận chuyển.', commit_sup_h:'Hỗ trợ tận tình', commit_sup_p:'Quýt trực Zalo/WhatsApp — hỏi gì cũng có người trả lời.', f_filter:'Bộ lọc', f_cat:'Danh mục', f_cat_all:'Tất cả', f_price:'Dải giá', f_price_all:'Tất cả', f_price_1:'Dưới 5 triệu', f_price_2:'5 – 15 triệu', f_price_3:'15 – 30 triệu', f_price_4:'Trên 30 triệu', f_brand:'Thương hiệu', f_search:'Tìm trong kết quả', f_sort:'Sắp xếp', sort_def:'Mặc định', sort_asc:'Giá thấp → cao', sort_desc:'Giá cao → thấp', filter_note:'Bộ sưu tập Mandarin Jam.', f_clear:'Xóa bộ lọc', empty_search_title:'Chưa tìm thấy sản phẩm phù hợp', empty_search_body:'Thử từ khóa khác hoặc xóa bộ lọc để xem thêm sản phẩm.', empty_cart_title:'Giỏ hàng của bạn đang trống', empty_cart_body:'Khám phá sản phẩm và thêm những món bạn yêu thích.', pdp_error_title:'Chưa thể tải sản phẩm', pdp_error_body:'Vui lòng thử lại hoặc xem các sản phẩm khác.', pdp_retry:'Thử lại', pdp_back:'Xem sản phẩm khác', pdp_choose_size:'Chọn kích cỡ', pdp_no_size:'Món này không có size (bán nguyên món).', search_ph:'Tìm thương hiệu, sản phẩm hoặc SKU', home_support_title:'Cần thêm thông tin?', home_support_body:'Cần tư vấn về sản phẩm hoặc kích cỡ? Quýt sẵn sàng hỗ trợ bạn.', empty_search_title:'Chưa tìm thấy sản phẩm phù hợp', empty_cart_title:'Giỏ hàng của bạn đang trống', empty_cart_body:'Khám phá sản phẩm và thêm những món bạn yêu thích.', pdp_error_title:'Chưa thể tải sản phẩm', pdp_error_body:'Vui lòng thử lại hoặc xem các sản phẩm khác.', pdp_retry:'Thử lại', pdp_choose_size:'Chọn kích cỡ', pdp_no_size:'Món này không có size (bán nguyên món).', footer_channels:'Kết nối với Mandarin Jam', footer_care:'Chăm sóc khách hàng', footer_legal_all:'Tất cả chính sách', home_title:'Thời trang & phụ kiện', home_view_all:'Xem tất cả sản phẩm', home_aria:'Mandarin Jam — Trang chủ', nav_brands:'Thương hiệu', nav_search:'Tìm kiếm', nav_bag:'Giỏ hàng', nav_language:'Ngôn ngữ', support_heading:'Cần tư vấn thêm?', support_body:'Liên hệ Mandarin Jam để được hỗ trợ về sản phẩm và kích cỡ.', support_cta:'Liên hệ tư vấn', pdp_support:'Tư vấn về sản phẩm này', cat_all:'Tất cả', cat_categories:'Danh mục', footer_info:'Thông tin', home_heading:'Gặp món bạn thích.', home_body:'Thời trang và phụ kiện được Mandarin Jam chọn lọc. Xem trên web, nhắn shop khi cần tư vấn.', home_shop:'Xem sản phẩm', home_chat:'Nhắn tư vấn', home_more:'Khám phá thêm', home_all:'Xem tất cả', ways_heading:'Chọn theo cách của bạn.', ways_web_title:'Khám phá trên web', ways_web_body:'Xem sản phẩm, kích cỡ và thông tin giá trước khi chọn.', ways_chat_title:'Trao đổi với Mandarin Jam', ways_chat_body:'Nhắn qua Zalo hoặc WhatsApp để hỏi thêm về sản phẩm và kích cỡ.', channels_heading:'Vẫn là Mandarin Jam bạn quen.', channels_body:'Theo dõi hoặc nhắn shop qua các kênh chính thức dưới đây.', channels_view_all:'Xem tất cả kênh chính thức', channels_view_less:'Thu gọn', channels_more_note:'Các kênh và nhóm khác của Mandarin Jam:', ch_official:'Official', ch_chat:'Chat', ch_group:'Nhóm nhận ưu đãi', ch_channel:'Kênh theo dõi', ch_hotline:'Hotline nhắn tin', nav_consult:'Tư vấn', nav_channels:'Kênh chính thức', info_title:'Thông tin mua hàng', info_sourcing:'Nguồn hàng', info_sourcing_body:'Mỗi món vào kệ đều qua tuyển chọn. Chi tiết theo <a href=\"\/legal\/dieu-khoan-mua-ban\">Điều khoản mua bán</a>.', info_ship:'Giao nhận và thanh toán', info_ship_body:'Thời gian giao hàng dự kiến 1–8 tuần. Xem <a href=\"\/legal\/van-chuyen\">chính sách vận chuyển</a> để biết phí và cách thanh toán, hoặc nhắn shop để xác nhận.', info_support:'Hỗ trợ sau mua', info_support_body:'Hỗ trợ qua Zalo/WhatsApp; đổi trả theo <a href=\"\/legal\/doi-tra\">Chính sách đổi trả</a>.', pdp_days:'ngày', pdp_size_out:'hết hàng', pdp_from:'Từ', toast_choose_size:'Hãy chọn một size còn hàng', toast_added:'Đã thêm vào giỏ', pdp_code:'Mã sản phẩm', pdp_color:'Màu', pdp_category_label:'Danh mục', pdp_no_image:'Chưa có ảnh', pdp_price_confirm:'Liên hệ để xác nhận giá', pdp_status_unknown:'Chưa có thông tin tình trạng hàng.', about_title:'Tuyển chọn chính hãng,<br>kiểm chứng nguồn gốc từng món', about_s1_h:'Tuyển chọn', about_s2_h:'Kiểm chứng', about_s3_h:'Mã đối chiếu', about_price:'Giá niêm yết bằng VND, hiển thị rõ trên từng món — không giá ảo.', about_contact:'Có món nào bạn muốn hỏi thêm? Quýt trực Zalo/WhatsApp — hỏi gì cũng có người trả lời.', cart_title:'Giỏ hàng', checkout_title:'Thanh toán', footer_line:'Thời trang và phụ kiện.', footer_terms:'Điều khoản & Chính sách', ship_est:'Thời gian giao hàng dự kiến: 1–8 tuần.', ship_note:'Thời gian có thể thay đổi tùy sản phẩm và địa chỉ nhận hàng.', footer_about:'Về Mandarin Jam', f_contact_us:'Liên hệ chúng tôi', f_orders_delivery:'Đơn hàng &amp; giao hàng', f_returns_refunds:'Đổi trả &amp; hoàn tiền', f_payment_pricing:'Thanh toán &amp; giá', f_faqs:'Câu hỏi thường gặp', f_authenticity:'Chính hãng &amp; tình trạng', f_company:'Thông tin công ty', f_privacy:'Chính sách bảo mật', f_terms:'Điều khoản &amp; điều kiện', f_cookie:'Chính sách cookie', f_customer_enq:'Liên hệ chăm sóc khách hàng', f_general_enq:'Liên hệ chung &amp; hợp tác', f_follow:'Theo dõi Mandarin Jam', f_payment_row:'Phương thức thanh toán được chấp nhận', f_contact_col:'Liên hệ &amp; theo dõi', ship_policy_label:'Chính sách vận chuyển' },
  en: { shop:'Shop', home:'Home', cart:'Cart', checkout:'Checkout', co_name:'Full name', co_phone:'Phone', co_addr:'Delivery address', co_note:'Note (optional)', co_next:'Continue →', co_back:'Back', co_cod:'Cash on delivery', co_review:'Review order', co_pay:'Payment', co_done:'Thank you! Order received.', co_done_sub:'Quyt received your order and is reviewing it to keep payment safe. Track its status — also check the app and email (incl. spam).', co_track:'Track order', co_order:'Order', co_notfound:'Order not found.', co_req_name:'Please enter your name.', co_req_phone:'Phone number looks invalid.', co_promo:'Web promo code', co_apply:'Apply', co_disc:'Discount', co_group:'Get more offers + new arrivals in the Mandarin Jam Zalo group.', co_group_btn:'Join Zalo group', co_promo_ok:'Code applied', co_promo_bad:'No such code.', co_promo_empty:'Enter a promo code.', co_card_soon:'Card payment coming soon (in preparation)', co_usd_note:'New-catalog items are priced in USD — card payment (USD) is being prepared and can’t be placed yet. Older items (VND) can still be ordered with COD.', co_usd_no_cod:'Your bag has new-catalog items priced in USD — COD is not available yet. Please wait for card payment to open, or order the older (VND) items separately.', addToCart:'Add to cart', buyNow:'Buy now', askQuyt:'Ask Quyt', outOfStock:'Out of stock', emptyCart:'Your bag is empty', emptyCartCta:'Continue shopping', shopHeading:'Shop', showMore:'Show more', itemsLeft:'items left', sizes:'sizes', outStock:'Out of stock',matchedSku:'Matched SKU:', category:'Category', breadcrumbHome:'Home', delivery:'Est. delivery', about:'About us', commitment:'Commitment', legal:'Terms & Policy', priceAsk:'Price on request', search:'Search', sort:'Sort', country:'Vietnam', applyOrder:'Place order', editCart:'Edit cart', shippingTo:'Ship to', subtotal:'Subtotal', total:'Total', source:'source', rate:'rate',
    nav_shop:'Shop', nav_about:'About Mandarin Jam', nav_commit:'Commitment', nav_support:'Support', hero_kicker:'THE MANDARIN JAM EDIT', hero_title:'Find your own style.', hero_sub:'Discover fashion and accessories from a range of brands, with personal guidance from Quýt.', cta_shop:'View shop', cta_shop_hero:'Explore products', cta_order:'Ask Quýt', hero_line:'You still chat with Quyt every day — now browse the web at your ease.', hero_note:'Collection:', featured_head:'Featured pieces', featured_more:'View all', home_social:'The same Mandarin Jam you know. <a href="https://zalo.me/3481730554380561086" target="_blank" rel="noopener">Ask Quyt</a> if you need a hand.', grid_loading:'Loading products…', commit_kicker:'Why Mandarin Jam', commit_head:'Quyt’s promise', commit_price_h:'Transparent pricing', commit_price_p:'Prices listed in VND, clear, no fake discounts.', commit_auth_h:'Authentic goods', commit_auth_p:'Every piece has its own product code, verifiable against authenticity records.', commit_del_h:'On-time delivery', commit_del_p:'Estimated delivery 1–8 weeks per our shipping policy.', commit_sup_h:'Helpful support', commit_sup_p:'Quyt is on Zalo/WhatsApp — ask anything, someone will answer.', f_filter:'Filters', f_cat:'Category', f_cat_all:'All', f_price:'Price range', f_price_all:'All', f_price_1:'Under 5M ₫', f_price_2:'5M – 15M ₫', f_price_3:'15M – 30M ₫', f_price_4:'Over 30M ₫', f_brand:'Brand', f_search:'Search results', f_sort:'Sort by', sort_def:'Default', sort_asc:'Price low → high', sort_desc:'Price high → low', filter_note:'The Mandarin Jam collection.', f_clear:'Clear filters', search_ph:'Search brands, products or SKU', home_support_title:'Need advice?', home_support_body:'Have a question about a product or size? Quýt is here to help.', empty_search_title:'No matching products', empty_search_body:'Try another search or clear your filters.', empty_cart_title:'Your cart is empty', empty_cart_body:'Explore the collection and add your favourite pieces.', pdp_error_title:"Unable to load this item", pdp_error_body:'Please try again or browse other products.', pdp_retry:'Try again', pdp_back:'Back to shop', pdp_choose_size:'Select a size', pdp_no_size:'This item has no sizes (sold as one piece).', footer_channels:'Connect with Mandarin Jam', footer_care:'Customer care', footer_legal_all:'All policies', home_title:'Clothing & accessories', home_view_all:'View all products', home_aria:'Mandarin Jam — Home', nav_brands:'Brands', nav_search:'Search', nav_bag:'Bag', nav_language:'Language', support_heading:'Need a hand?', support_body:'Contact Mandarin Jam for help with products and sizing.', support_cta:'Contact us', pdp_support:'Ask about this item', cat_all:'All', cat_categories:'Categories', footer_info:'Information', home_heading:'Find something you love.', home_body:'Clothing and accessories selected by Mandarin Jam. Browse here and message us for advice.', home_shop:'Explore the shop', home_chat:'Get in touch', home_more:'More to explore', home_all:'View all', ways_heading:'Shop your way.', ways_web_title:'Explore the shop', ways_web_body:'Explore products, sizes and pricing before you choose.', ways_chat_title:'Talk to Mandarin Jam', ways_chat_body:'Message us on Zalo or WhatsApp for help with products and sizing.', channels_heading:'The Mandarin Jam you know.', channels_body:'Follow or message the shop through the official channels below.', channels_view_all:'View all official channels', channels_view_less:'Show fewer', channels_more_note:'Other Mandarin Jam channels and groups:', ch_official:'Official', ch_chat:'Chat', ch_group:'Rewards group', ch_channel:'Follow channel', ch_hotline:'Hotline (chat)', nav_consult:'Consult', nav_channels:'Official channels', info_title:'Shopping information', info_sourcing:'Sourcing', info_sourcing_body:'Every piece is selected before it is listed. See the <a href=\"\/legal\/dieu-khoan-mua-ban\">Terms of sale</a>.', info_ship:'Delivery and payment', info_ship_body:'Estimated delivery is 1–8 weeks. See the <a href=\"\/legal\/van-chuyen\">shipping policy</a> for costs and payment options, or message us to confirm.', info_support:'After-purchase support', info_support_body:'Support via Zalo/WhatsApp; returns follow the <a href=\"\/legal\/doi-tra\">Return policy</a>.', pdp_days:'days', pdp_size_out:'Out of stock', pdp_from:'From', toast_choose_size:'Please select an available size', toast_added:'Added to your bag', pdp_code:'Product code', pdp_color:'Colour', pdp_category_label:'Category', pdp_no_image:'Image unavailable', pdp_price_confirm:'Contact us to confirm the price', pdp_status_unknown:'Availability information is not available.', about_title:'Curated authentic goods,<br>origin verified piece by piece', about_s1_h:'Selection', about_s2_h:'Verification', about_s3_h:'Match code', about_price:'Prices listed in VND, clear on every piece — no fake discounts.', about_contact:'Want to ask more about a piece? Quyt is on Zalo/WhatsApp — ask anything, someone will answer.', cart_title:'Cart', checkout_title:'Checkout', footer_line:'Clothing and accessories.', footer_terms:'Terms & Policy', ship_est:'Estimated delivery: 1–8 weeks.', ship_note:'Timing may vary by item and delivery destination.', footer_about:'About Mandarin Jam', f_contact_us:'Contact us', f_orders_delivery:'Orders &amp; delivery', f_returns_refunds:'Returns &amp; refunds', f_payment_pricing:'Payment &amp; pricing', f_faqs:'FAQs', f_authenticity:'Authenticity &amp; condition', f_company:'Company information', f_privacy:'Privacy policy', f_terms:'Terms &amp; conditions', f_cookie:'Cookie policy', f_customer_enq:'Customer enquiries', f_general_enq:'General enquiries &amp; partnerships', f_follow:'Follow Mandarin Jam', f_payment_row:'Accepted payment methods', f_contact_col:'Contact &amp; follow', ship_policy_label:'Shipping policy' },
  zh: { shop:'商店', home:'首页', cart:'购物车', checkout:'结账', co_name:'姓名', co_phone:'电话', co_addr:'收货地址', co_note:'备注（选填）', co_next:'继续 →', co_back:'返回', co_cod:'货到付款', co_review:'确认订单', co_pay:'支付', co_done:'感谢！已收到订单。', co_done_sub:'桔子已收到订单，正在审核以确保支付安全。可追踪状态 — 也请检查 App 和邮箱（含垃圾箱）。', co_track:'追踪订单', co_order:'订单', co_notfound:'未找到该订单。', co_req_name:'请输入姓名。', co_req_phone:'电话号码无效。', co_promo:'网页优惠码', co_apply:'应用', co_disc:'优惠', co_group:'加入 Mandarin Jam Zalo 群，获取更多优惠与新品。', co_group_btn:'加入 Zalo 群', co_promo_ok:'优惠码已应用', co_promo_bad:'没有此优惠码。', co_promo_empty:'请输入优惠码。', co_card_soon:'卡支付即将开放（准备中）', co_usd_note:'新目录商品以美元计价 — 卡支付（美元）正在准备，暂时无法下单。旧商品（越南盾）仍可货到付款下单。', co_usd_no_cod:'购物车内有美元计价的新目录商品 — 暂不支持货到付款。请等待卡支付开放，或单独下单旧商品（越南盾）。', addToCart:'加入购物车', buyNow:'立即购买', askQuyt:'咨询桔子', outOfStock:'暂时缺货', emptyCart:'购物袋为空', emptyCartCta:'继续购物', shopHeading:'商品', showMore:'查看更多', itemsLeft:'件商品', sizes:'尺码', outStock:'缺货',matchedSku:'匹配SKU：', category:'分类', breadcrumbHome:'首页', delivery:'预计配送', about:'关于我们', commitment:'承诺', legal:'条款与政策', priceAsk:'咨询价格', search:'搜索', sort:'排序', country:'越南', applyOrder:'下单', editCart:'编辑购物车', shippingTo:'送至', subtotal:'小计', total:'合计', source:'来源', rate:'汇率',
    nav_shop:'商品', nav_about:'关于 Mandarin Jam', nav_commit:'承诺', nav_support:'帮助', hero_kicker:'MANDARIN JAM 精选', hero_title:'发现属于你的风格。', hero_sub:'探索多个品牌的时装与配饰，Quýt 随时为你提供贴心建议。', cta_shop:'逛商店', cta_shop_hero:'浏览商品', cta_order:'咨询 Quýt', hero_line:'和桔子每天聊天依旧 — 现在也能在网页上畅快逛货。', hero_note:'系列精选：', featured_head:'精选单品', featured_more:'查看全部', home_social:'还是你熟悉的 Mandarin Jam。需要帮忙，随时<a href="https://zalo.me/3481730554380561086" target="_blank" rel="noopener">找桔子</a>。', home_contact:'想更快选好？直接找桔子，秒回帮你挑。', grid_loading:'正在加载商品…', commit_kicker:'为什么选择 Mandarin Jam', commit_head:'桔子的承诺', commit_price_h:'价格透明', commit_price_p:'价格以越南盾标价，清晰明了，无虚价。', commit_auth_h:'正品保障', commit_auth_p:'每件商品都有独立编码，可与验真凭证一一核对。', commit_del_h:'准时送达', commit_del_p:'预计送达时间1–8周，详见配送政策。', commit_sup_h:'贴心服务', commit_sup_p:'桔子在 Zalo/WhatsApp 在线 — 有问必答。', f_filter:'筛选', f_cat:'品类', f_cat_all:'全部', f_price:'价格区间', f_price_all:'全部', f_price_1:'低于500万₫', f_price_2:'500万–1500万₫', f_price_3:'1500万–3000万₫', f_price_4:'3000万₫以上', f_brand:'品牌', f_search:'在结果中搜索', f_sort:'排序', sort_def:'默认', sort_asc:'价格从低到高', sort_desc:'价格从高到低', filter_note:'Mandarin Jam 系列精选。', f_clear:'清除筛选', search_ph:'搜索品牌、商品或SKU', home_support_title:'需要建议？', home_support_body:'对商品或尺码有疑问？Quýt 随时为你提供帮助。', empty_search_title:'未找到匹配的商品', empty_search_body:'请尝试其他关键词或清除筛选条件。', empty_cart_title:'你的购物车还是空的', empty_cart_body:'浏览商品，把喜欢的单品加入购物车。', pdp_error_title:'暂时无法加载此商品', pdp_error_body:'请重试，或浏览其他商品。', pdp_retry:'重试', pdp_back:'查看其他商品', pdp_choose_size:'选择尺码', pdp_no_size:'此商品没有尺码（整件出售）。', footer_channels:'关注 Mandarin Jam', footer_care:'客户服务', footer_legal_all:'全部政策', home_title:'服装与配饰', home_view_all:'查看全部商品', home_aria:'Mandarin Jam — 首页', nav_brands:'品牌', nav_search:'搜索', nav_bag:'购物袋', nav_language:'语言', support_heading:'需要帮助？', support_body:'如需商品或尺码建议，请联系 Mandarin Jam。', support_cta:'联系我们', pdp_support:'咨询此商品', cat_all:'全部', cat_categories:'商品分类', footer_info:'网站信息', home_heading:'发现心仪好物。', home_body:'Mandarin Jam 精选服装与配饰。在线浏览，需要建议时随时联系我们。', home_shop:'浏览商品', home_chat:'联系咨询', home_more:'继续探索', home_all:'查看全部', ways_heading:'按你的方式选购。', ways_web_title:'在线浏览', ways_web_body:'挑选前，先查看商品、尺码和价格信息。', ways_chat_title:'联系 Mandarin Jam', ways_chat_body:'通过 Zalo 或 WhatsApp 咨询商品与尺码。', channels_heading:'还是你熟悉的 Mandarin Jam。', channels_body:'通过以下官方渠道关注或联系店铺。', channels_view_all:'查看全部官方渠道', channels_view_less:'收起', channels_more_note:'Mandarin Jam 的其他渠道与群组：', ch_official:'官方', ch_chat:'聊天', ch_group:'优惠群组', ch_channel:'关注频道', ch_hotline:'短信热线', nav_consult:'咨询', nav_channels:'官方渠道', info_title:'购物信息', info_sourcing:'货源', info_sourcing_body:'每件商品上架前均经过挑选。详见<a href=\"\/legal\/dieu-khoan-mua-ban\">销售条款</a>。', info_ship:'配送与支付', info_ship_body:'预计送达时间为1–8周。请查看<a href=\"\/legal\/van-chuyen\">配送政策</a>了解运费与付款方式，或联系商店确认。', info_support:'售后支持', info_support_body:'通过 Zalo/WhatsApp 提供支持；退换按<a href=\"\/legal\/doi-tra\">退换政策</a>。', pdp_days:'天', pdp_size_out:'售罄', pdp_from:'起价', toast_choose_size:'请选择有库存的尺码', toast_added:'已加入购物袋', pdp_code:'商品编号', pdp_color:'颜色', pdp_category_label:'分类', pdp_no_image:'暂无图片', pdp_price_confirm:'请联系我们确认价格', pdp_status_unknown:'暂无库存状态信息。', about_title:'正品臻选，<br>逐件溯源可查', about_s1_h:'精选', about_s2_h:'验真', about_s3_h:'编码核对', about_price:'价格以越南盾标价，每件清晰可见 — 无虚价。', about_contact:'想进一步了解某件商品？桔子在 Zalo/WhatsApp 在线 — 有问必答。', cart_title:'购物车', checkout_title:'结账', footer_line:'服装与配饰。', footer_terms:'条款与政策', ship_est:'预计送达时间：1–8周。', ship_note:'具体时间可能因商品和收货地址而异。', footer_about:'关于 Mandarin Jam', f_contact_us:'联系我们', f_orders_delivery:'订单与配送', f_returns_refunds:'退换与退款', f_payment_pricing:'付款与价格', f_faqs:'常见问题', f_authenticity:'正品与状态', f_company:'公司信息', f_privacy:'隐私政策', f_terms:'条款与条件', f_cookie:'Cookie 政策', f_customer_enq:'客户咨询', f_general_enq:'一般咨询与合作', f_follow:'关注 Mandarin Jam', f_payment_row:'支持的付款方式', f_contact_col:'联系与关注', ship_policy_label:'配送政策' },
  ko: { shop:'쇼핑', home:'홈', cart:'장바구니', checkout:'결제', co_name:'이름', co_phone:'전화번호', co_addr:'배송지', co_note:'메모(선택)', co_next:'계속 →', co_back:'뒤로', co_cod:'배송비 현금 지불', co_review:'주문 확인', co_pay:'결제', co_done:'감사합니다! 주문을 접수했습니다.', co_done_sub:'궽이 주문을 접수하고 안전한 결제를 위해 검토 중입니다. 상태를 추적하세요 — 앱과 이메일(스팸 포함)도 확인하세요.', co_track:'주문 추적', co_order:'주문', co_notfound:'주문을 찾을 수 없습니다.', co_req_name:'이름을 입력하세요.', co_req_phone:'전화번호가 올바르지 않습니다.', co_promo:'웹 프로모션 코드', co_apply:'적용', co_disc:'할인', co_group:'Mandarin Jam Zalo 그룹에서 더 많은 혜택과 신상품을 받아보세요.', co_group_btn:'Zalo 그룹 참여', co_promo_ok:'코드 적용됨', co_promo_bad:'해당 코드가 없습니다.', co_promo_empty:'프로모션 코드를 입력하세요.', co_card_soon:'카드 결제는 준비 중입니다', co_usd_note:'신제품은 USD로 가격이 책정됩니다 — 카드 결제(USD) 준비 중이라 아직 주문할 수 없습니다. 기존 상품(VND)은 COD 주문이 가능합니다.', co_usd_no_cod:'장바구니에 USD 가격의 신제품이 있어 COD 주문을 할 수 없습니다. 카드 결제 개방을 기다리거나 기존 상품(VND)을 따로 주문해 주세요.', addToCart:'장바구니에 담기', buyNow:'바로 구매', askQuyt:'궽에게 문의', outOfStock:'일시 품절', emptyCart:'쇼핑백이 비어 있습니다', emptyCartCta:'쇼핑 계속하기', shopHeading:'상품', showMore:'더 보기', itemsLeft:'개 남음', sizes:'사이즈', outStock:'품절',matchedSku:'일치 SKU:', category:'카테고리', breadcrumbHome:'홈', delivery:'예상 배송', about:'회사 소개', commitment:'약속', legal:'약관 및 정책', priceAsk:'가격 문의', search:'검색', sort:'정렬', country:'베트남', applyOrder:'주문하기', editCart:'장바구니 편집', shippingTo:'배송지', subtotal:'소계', total:'합계', source:'출처', rate:'환율',
    nav_shop:'상품', nav_about:'Mandarin Jam 소개', nav_commit:'약속', nav_support:'고객 지원', hero_kicker:'THE MANDARIN JAM EDIT', hero_title:'나만의 스타일을 찾아보세요.', hero_sub:'다양한 브랜드의 패션과 액세서리를 만나보세요. Quýt가 필요한 상담을 도와드립니다.', cta_shop:'쇼핑 보기', cta_shop_hero:'상품 둘러보기', cta_order:'Quýt에게 문의하기', hero_line:'궽과 매일 대화는 그대로 — 이제 웹에서 편하게 구경하세요.', hero_note:'컬렉션:', featured_head:'추천 상품', featured_more:'전체 보기', home_social:'당신이 아는 그 Mandarin Jam이에요. 도움이 필요하면 <a href="https://zalo.me/3481730554380561086" target="_blank" rel="noopener">궽에게 메시지</a> 주세요.', grid_loading:'상품을 불러오는 중…', commit_kicker:'Mandarin Jam을 고르는 이유', commit_head:'궽의 약속', commit_price_h:'투명한 가격', commit_price_p:'VND로 명시된 정직한 가격.', commit_auth_h:'정품 보장', commit_auth_p:'모든 상품은 검증 서류와 대조 가능한 고유 코드를 가집니다.', commit_del_h:'정시 배송', commit_del_p:'예상 배송 기간 1–8주이며 배송 정책을 따릅니다.', commit_sup_h:'친절한 지원', commit_sup_p:'궽이 Zalo/WhatsApp에 상주 — 무엇이든 답해 드립니다.', f_filter:'필터', f_cat:'카테고리', f_cat_all:'전체', f_price:'가격대', f_price_all:'전체', f_price_1:'500만₫ 미만', f_price_2:'500만–1500만₫', f_price_3:'1500만–3000만₫', f_price_4:'3000만₫ 이상', f_brand:'브랜드', f_search:'결과 내 검색', f_sort:'정렬', sort_def:'기본', sort_asc:'낮은 가격 → 높은 가격', sort_desc:'높은 가격 → 낮은 가격', filter_note:'Mandarin Jam 컬렉션.', f_clear:'필터 초기화', search_ph:'브랜드, 상품 또는 SKU 검색', home_support_title:'상담이 필요하신가요?', home_support_body:'상품이나 사이즈가 궁금하신가요? Quýt가 도와드릴게요.', empty_search_title:'조건에 맞는 상품이 없습니다', empty_search_body:'다른 검색어를 입력하거나 필터를 초기화해 주세요.', empty_cart_title:'장바구니가 비어 있습니다', empty_cart_body:'상품을 둘러보고 마음에 드는 아이템을 담아보세요.', pdp_error_title:'상품을 불러올 수 없습니다', pdp_error_body:'다시 시도하거나 다른 상품을 둘러보세요.', pdp_retry:'다시 시도', pdp_back:'다른 상품 보기', pdp_choose_size:'사이즈 선택', pdp_no_size:'이 상품은 사이즈가 없습니다(한 벌로 판매).', footer_channels:'Mandarin Jam과 소통하기', footer_care:'고객 지원', footer_legal_all:'모든 정책', home_title:'의류 및 액세서리', home_view_all:'전체 상품 보기', home_aria:'Mandarin Jam — 홈', nav_brands:'브랜드', nav_search:'검색', nav_bag:'쇼핑백', nav_language:'언어', support_heading:'도움이 필요하신가요?', support_body:'상품이나 사이즈에 관해 궁금한 점은 Mandarin Jam에 문의해 주세요.', support_cta:'문의하기', pdp_support:'이 상품 문의하기', cat_all:'전체', cat_categories:'카테고리', footer_info:'사이트 정보', home_heading:'마음에 드는 아이템을 만나보세요.', home_body:'Mandarin Jam이 고른 의류와 액세서리. 웹에서 둘러보고 궁금한 점은 메시지로 문의해 주세요.', home_shop:'상품 둘러보기', home_chat:'상담 문의', home_more:'더 둘러보기', home_all:'전체 보기', ways_heading:'편한 방법으로 쇼핑하세요.', ways_web_title:'웹에서 둘러보기', ways_web_body:'선택하기 전에 상품, 사이즈와 가격 정보를 확인해 보세요.', ways_chat_title:'Mandarin Jam에 문의하기', ways_chat_body:'상품과 사이즈는 Zalo 또는 WhatsApp으로 문의해 주세요.', channels_heading:'늘 곁에 있는 Mandarin Jam.', channels_body:'아래 공식 채널로 팔로우하거나 문의해 주세요.', channels_view_all:'모든 공식 채널 보기', channels_view_less:'접기', channels_more_note:'Mandarin Jam의 다른 채널과 그룹:', ch_official:'공식', ch_chat:'채팅', ch_group:'혜택 그룹', ch_channel:'채널 팔로우', ch_hotline:'문의 전화', nav_consult:'상담', nav_channels:'공식 채널', info_title:'쇼핑 정보', info_sourcing:'조달', info_sourcing_body:'모든 아이템은 선별 후 판매됩니다. 자세한 내용은 <a href=\"\/legal\/dieu-khoan-mua-ban\">판매 약관</a>을 참고하세요.', info_ship:'배송 및 결제', info_ship_body:'예상 배송 기간은 1–8주입니다. <a href=\"\/legal\/van-chuyen\">배송 정책</a>에서 배송비와 결제 방법을 확인하거나 매장에 문의해 주세요.', info_support:'구매 후 지원', info_support_body:'Zalo/WhatsApp로 지원합니다; 반품은 <a href=\"\/legal\/doi-tra\">반품 정책</a>을 따릅니다.', pdp_days:'일', pdp_size_out:'품절', pdp_from:'최저', toast_choose_size:'재고 있는 사이즈를 선택해 주세요', toast_added:'장바구니에 담았습니다', pdp_code:'상품 코드', pdp_color:'색상', pdp_category_label:'카테고리', pdp_no_image:'이미지 없음', pdp_price_confirm:'가격 문의', pdp_status_unknown:'재고 상태 정보가 없습니다.', about_title:'정품 셀렉션,<br>원산지 검증', about_s1_h:'선별', about_s2_h:'검증', about_s3_h:'코드 대조', about_price:'가격은 VND로 명시되며 각 상품에 표시됩니다 — 허위 할인 없음.', about_contact:'상품에 대해 더 궁금하신가요? 궽이 Zalo/WhatsApp에 상주 — 무엇이든 답해 드립니다.', cart_title:'장바구니', checkout_title:'결제', footer_line:'의류 및 액세서리.', footer_terms:'약관 및 정책', ship_est:'예상 배송 기간: 1–8주.', ship_note:'상품 및 배송지에 따라 기간이 달라질 수 있습니다.', footer_about:'Mandarin Jam 소개', f_contact_us:'문의하기', f_orders_delivery:'주문 및 배송', f_returns_refunds:'반품 및 환불', f_payment_pricing:'결제 및 가격', f_faqs:'자주 묻는 질문', f_authenticity:'정품 및 상태', f_company:'회사 정보', f_privacy:'개인정보 처리방침', f_terms:'이용 약관', f_cookie:'쿠키 정책', f_customer_enq:'고객 문의', f_general_enq:'일반 문의 및 제휴', f_follow:'Mandarin Jam 팔로우', f_payment_row:'지원 결제 수단', f_contact_col:'연락 및 팔로우', ship_policy_label:'배송 정책' }
};
/* SHOP-R1 bổ sung: các nhãn mới cho sidebar/dialog/chips/empty. Fallback vi; nếu LANG thiếu key dùng vi. */
const _SHOP_R1_I18N = {
  vi: { ps_unit:'món', f_more:'Xem thêm', f_collapse:'Thu gọn', f_apply:'Áp dụng', f_clear_draft:'Xóa lựa chọn', f_clear_all:'Xóa tất cả', f_search_brand:'Tìm thương hiệu…', filter_support:'Cần tư vấn?', filter_support2:'Nhắn shop', grid_error:'Không tải được danh sách sản phẩm. Vui lòng thử lại.', show_more:'Hiển thị thêm', all_shown:'Đã hiển thị hết', showing:'Hiển thị', showing_range:'Hiển thị 1–{a} / {b}', loadmore_err:'Không tải thêm được trang này.', loadmore_retry:'Thử lại', search_heading:'Tìm kiếm', nav_home:'Trang chủ', nav_all:'Tất cả sản phẩm', nav_brands:'Thương hiệu', nav_customer_care:'Chăm sóc khách hàng', dept_men_aria:'Bộ sưu tập Nam', dept_women_aria:'Bộ sưu tập Nữ', dept_kids_aria:'Bộ sưu tập Trẻ em', dept_preparing:'Nhóm này đang được chuẩn bị.', dept_browse_all:'Xem tất cả sản phẩm', f_dept:'Danh mục chính', f_cat2:'Danh mục', f_type:'Loại', f_price_min:'Tối thiểu (US$)', f_price_max:'Tối đa (US$)', f_price_err:'Giá không hợp lệ — nhập số ≥ 0 và tối thiểu ≤ tối đa.', f_show_results:'Xem {n} kết quả', f_back:'Quay lại', f_retail:'Giá bán lẻ tham chiếu', f_vnd_ref:'tham khảo', f_from:'Từ', f_close:'Đóng', f_reset:'Đặt lại', f_hint_dept:'Chọn danh mục chính trước để xem danh mục con.', pdp_price_usd:'Giá (USD)' },
    en: { ps_unit:'items', f_more:'Show more', f_collapse:'Show fewer', f_apply:'Apply', f_clear_draft:'Clear selection', f_clear_all:'Clear all', f_search_brand:'Search brands…', filter_support:'Need help?', filter_support2:'Message the shop', grid_error:'Could not load products. Please try again.', show_more:'Show more', all_shown:'All shown', showing:'Showing', showing_range:'Showing 1–{a} of {b}', loadmore_err:'Could not load this page.', loadmore_retry:'Retry', search_heading:'Search', nav_home:'Home', nav_all:'All products', nav_brands:'Brands', nav_customer_care:'Customer care', dept_men_aria:'Men’s collection', dept_women_aria:'Women’s collection', dept_kids_aria:'Kids’ collection', dept_preparing:'This selection is being prepared.', dept_browse_all:'Browse all products', f_dept:'Department', f_cat2:'Category', f_type:'Type', f_price_min:'Min (US$)', f_price_max:'Max (US$)', f_price_err:'Invalid price — enter numbers ≥ 0 with min ≤ max.', f_show_results:'Show {n} results', f_back:'Back', f_retail:'Retail reference price', f_vnd_ref:'reference only', f_from:'From', f_close:'Close', f_reset:'Reset', f_hint_dept:'Pick a department first to see its categories.', pdp_price_usd:'Price (USD)' },
    zh: { ps_unit:'件', f_more:'查看更多', f_collapse:'收起', f_apply:'应用', f_clear_draft:'清除选择', f_clear_all:'清除全部', f_search_brand:'搜索品牌…', filter_support:'需要帮助？', filter_support2:'联系客服', grid_error:'无法加载商品，请重试。', show_more:'查看更多', all_shown:'已全部显示', showing:'显示', showing_range:'显示 1–{a} / {b}', loadmore_err:'此页加载失败。', loadmore_retry:'重试', search_heading:'搜索', nav_home:'首页', nav_all:'全部商品', nav_brands:'品牌', nav_customer_care:'客户服务', dept_men_aria:'男士系列', dept_women_aria:'女士系列', dept_kids_aria:'儿童系列', dept_preparing:'此分类正在准备中。', dept_browse_all:'浏览全部商品', f_dept:'品类大类', f_cat2:'品类', f_type:'类型', f_price_min:'最低 (US$)', f_price_max:'最高 (US$)', f_price_err:'价格无效 — 请输入 ≥0 的数字，且最低 ≤ 最高。', f_show_results:'查看 {n} 件结果', f_back:'返回', f_retail:'零售参考价', f_vnd_ref:'仅供参考', f_from:'起价', f_close:'关闭', f_reset:'重置', f_hint_dept:'先选择大类查看子类。', pdp_price_usd:'价格（美元）' },
    ko: { ps_unit:'개', f_more:'더 보기', f_collapse:'접기', f_apply:'적용', f_clear_draft:'선택 지우기', f_clear_all:'모두 지우기', f_search_brand:'브랜드 검색…', filter_support:'도움이 필요하세요?', filter_support2:'쇼핑 문의', grid_error:'상품을 불러올 수 없습니다. 다시 시도해 주세요.', show_more:'더 보기', all_shown:'전체 표시됨', showing:'표시', showing_range:'표시 1–{a} / {b}', loadmore_err:'이 페이지를 불러올 수 없습니다.', loadmore_retry:'다시 시도', search_heading:'검색', nav_home:'홈', nav_all:'전체 상품', nav_brands:'브랜드', nav_customer_care:'고객 지원', dept_men_aria:'남성 컬렉션', dept_women_aria:'여성 컬렉션', dept_kids_aria:'키즈 컬렉션', dept_preparing:'이 카테고리를 준비 중입니다.', dept_browse_all:'전체 상품 보기', f_dept:'부서', f_cat2:'카테고리', f_type:'유형', f_price_min:'최소 (US$)', f_price_max:'최대 (US$)', f_price_err:'유효하지 않은 가격 — 0 이상의 숫자를 입력하고, 최소 ≤ 최대를 맞춰 주세요.', f_show_results:'{n}개 결과 보기', f_back:'뒤로', f_retail:'소매 기준가', f_vnd_ref:'참고용', f_from:'최저', f_close:'닫기', f_reset:'초기화', f_hint_dept:'먼저 대분류를 선택해 소분류를 확인하세요.', pdp_price_usd:'가격 (USD)' },
  };
function t(key){ const m = T[LANG] || T.vi; if (m[key] != null) return m[key]; const r = (_SHOP_R1_I18N[LANG] || _SHOP_R1_I18N.vi); if (r[key] != null) return r[key]; return T.vi[key] != null ? T.vi[key] : key; }
function tpl(key, vars){ let s = String(t(key) ?? ''); Object.keys(vars || {}).forEach(k => s = s.split('{' + k + '}').join(String(vars[k]))); return s; }
// Áp text tĩnh (data-i18n trong index.html) theo ngôn ngữ hiện tại
function applyStaticI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    const v = t(k);
    if (v == null) return;
    el.innerHTML = v; // hero_title/about_title chứa <br><em>
  });
  // W2 C1: placeholder dịch theo locale (search.placeholder trong PMO_COPY_W2.json)
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const v2 = t(el.getAttribute('data-i18n-ph'));
    if (v2 != null) el.setAttribute('placeholder', v2);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const v3 = t(el.getAttribute('data-i18n-aria'));
    if (v3 != null) el.setAttribute('aria-label', v3);
  });
  // W4 F: accordion body chứa link — render HTML đã duyệt
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const v4 = t(el.getAttribute('data-i18n-html'));
    if (v4 != null) el.innerHTML = v4;
  });
}
/* Giá theo ngôn ngữ (đã tính sẵn 4 mốc trên server theo §7.1: price_vi/en/ko/zh).
   raw: item server (lot1_full) có price_vi/en/ko/zh + name_vi/en/ko/zh. */
function langName(raw){ return raw['name_' + LANG] || raw['name_vi'] || raw['name_zh'] || ''; }
function langDesc(raw){ return raw['desc_' + LANG] || (LANG === 'zh' ? raw['desc_zh'] : raw['desc_vi']) || ''; }
function langPrice(raw){
  const v = raw['price_' + LANG]; if (v == null) return null;
  if (LANG === 'vi') return new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' ₫';
  return '$' + Math.round(v).toLocaleString('en-US'); // EN/KO = $, ZH cũng dùng $ theo quy ước? xem dưới
}
function fmtPrice(v, lang){
  if (lang === 'vi') return new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' ₫';
  if (lang === 'zh') return '¥' + Math.round(v).toLocaleString('en-US');
  return '$' + Math.round(v).toLocaleString('en-US'); // en/ko
}

/* ---------------- normalize ----------------
   payload: {spuId, saleSpuId, listItem{...}, detail{...}, sizeDetail{spuBlockInfos[{spuDetailInfos[...]}]}}
   Giá bán VND tính từ payload giá CNY của món (chi tiết xem server). */
function normalizeSku(s){
  // CATALOG-R1 §4D: V2 SKU có salePriceUsd/referencePriceUsd (dollar, USD) + stock thật.
  // priceCNY giữ cho legacy (lot1) — item _v2 KHÔNG chạy qua CNY×4000×margin (double markup).
  return {
    skuId: s.skuId,
    spuId: s.spuId,
    size: s.size || '—',
    stock: Number(s.stock) || 0,
    stockRaw: s.stock,
    priceCNY: Number(s.totalPrice) || 0,
    imPrice: Number(s.imPrice) || 0,
    salePriceUsd: Number(s.salePriceUsd) || 0,
    referencePriceUsd: Number(s.referencePriceUsd) || 0,
    skuCurrency: s.currency || (s.salePriceUsd != null ? 'USD' : null),
    minDay: s.minDay, maxDay: s.maxDay,
    timeLine: s.timeLineDesc || '',
    logType: s.spuLogisticsTypeName || '',
  };
}
// W2.3: danh mục shop tiếng Việt (fallback client khi list không có _i18n)
const CAT_VI_CLIENT = {
  'POLO/T恤/上衣':'Áo polo / Áo thun / Áo','上衣':'Áo','休闲/运动鞋':'Giày thể thao','其他':'Phụ kiện khác',
  '凉鞋/拖鞋':'Dép / Sandal','单肩包/斜挎包':'Túi đeo vai / Túi chéo','卫衣/针织衫':'Áo hoodie / Áo len','商务正装鞋':'Giày công sở',
  '围巾/丝巾':'Khăn choàng / Khăn lụa','大衣/羽绒服':'Áo khoác dài / Áo phao','太阳镜':'Kính râm','夹克/外套':'Áo khoác / Jacket',
  '套装':'Bộ đồ','帽子':'Mũ','平底鞋/便鞋':'Giày bệt','手拿包/迷你包':'Túi xách tay / Túi mini','手提包':'Túi xách tay',
  '泳装':'Đồ bơi','牛仔裤':'Quần jean','皮带/腰带':'Thắt lưng','短裤':'Quần short','衬衫':'Áo sơ mi',
  '裙装':'Váy / Chân váy','裤装':'Quần dài','钥匙包/钥匙扣':'Ví chìa khóa / Móc khóa','钱包':'Ví',
  '靴子/高帮鞋':'Bốt / Giày cổ cao','首饰':'Trang sức','高跟鞋':'Giày cao gót',
};
const catVi = (zh) => CAT_VI_CLIENT[zh] || zh || '';

function normalizeProduct(p){
  const d = p.detail || {};
  const skus = [];
  (d.sizeDetail || p.sizeDetail || {spuBlockInfos: []}).spuBlockInfos?.forEach(b => {
    (b.spuDetailInfos || []).forEach(s => skus.push(normalizeSku(s)));
  });
  // W7-R3 C1: loại SKU rác/thiếu skuId — không dùng nó làm "size hợp lệ" hay cờ sizeKnown
  for (let i = skus.length - 1; i >= 0; i--) if (skus[i].skuId == null) skus.splice(i, 1);
  const avail = skus.filter(s => s.stock > 0);
  const minCNY = avail.length ? Math.min(...avail.map(s => s.priceCNY)) : (Number(d.salePrice) || 0);
  // W7-R2: tách known/unknown — không dùng Number(x)||0 làm bằng chứng tồn kho
  // W7-R3 B1: sizeKnown chỉ true khi sizeDetail có block + SKU — empty object/list không chứng minh "không có size"
  // W7-R3 C2: stockState dùng CÙNG predicate known như chip — number, finite, >=0.
  //   NaN/Infinity/âm/missing/string KHÔNG được suy known-out (đừng báo hết hàng từ dữ liệu sai).
  const sizeKnown = !!(p.sizeDetail || d.sizeDetail) && skus.length > 0;
  const stockKnown = s => typeof s.stockRaw === 'number' && Number.isFinite(s.stockRaw) && s.stockRaw >= 0;
  const allStockKnown = skus.length > 0 && skus.every(stockKnown);
  const stockState = (sizeKnown && allStockKnown) ? (avail.length > 0 ? 'in-stock' : 'known-out') : 'unknown';
  // CATALOG-R1 §4D: V2 = USD trực tiếp từ customer DTO (salePriceUsd/referencePriceUsd theo SKU).
  // Không qua CNY×4000×margin — đó là công thức legacy lot1 (priceCNY).
  const isV2 = !!p._v2;
  const usdOf = s => Number(s.salePriceUsd) || 0;
  const availUsd = avail.map(usdOf).filter(v => v > 0);
  const minUsd = availUsd.length ? Math.min(...availUsd) : (isV2 ? (Number(p.saleUsdMin) || 0) : 0);
  const brand = d.brand || p.brand || p.listItem?.brandName || '—';
  const i18n = p._i18n || {};
  const pLANG = LANG; // PDP dùng LANG hiện tại
  const nameView = {vi: i18n.name_vi, en: i18n.name_en || i18n.name_vi, ko: i18n.name_ko || i18n.name_vi, zh: i18n.name_zh || i18n.name_vi}[pLANG] || i18n.name_vi || d.name || p.name || p.listItem?.spuName || 'Sản phẩm';
  const descView = {vi: i18n.desc_vi, en: i18n.desc_en || i18n.desc_vi, ko: i18n.desc_ko || i18n.desc_vi, zh: i18n.desc_zh || i18n.desc_vi}[pLANG] || i18n.desc_vi || '';
  const priceView = {vi: i18n.price_vi, en: i18n.price_en, ko: i18n.price_ko, zh: i18n.price_zh}[pLANG];
  return {
    spuId: Number(p.spuId),
    name: nameView,
    nameZh: i18n.name_zh || d.name || p.name || '',
    nameEn: i18n.name_en || '',
    nameKo: i18n.name_ko || '',
    name_LANG: pLANG,
    descVn: descView,
    descEn: i18n.desc_en || '',
    descKo: i18n.desc_ko || '',
    priceViewRaw: priceView,          // mốc giá theo LANG (server §7.1) — null nếu SKU ngoài lô 1
    price_vi: i18n.price_vi, price_en: i18n.price_en, price_ko: i18n.price_ko, price_zh: i18n.price_zh,
    brand,
    // R-BRANDCODE: Mã sản phẩm gốc thương hiệu (Brand/Style code) — KHÔNG phải skuId nội bộ.
    // color có thể là mảng (vd ["Blue/Orange"]) hoặc chuỗi; trả chuỗi gọn cho khách.
    brandCode: String(p.brandCode || d.brandCode || '').trim(),
    color: (Array.isArray(p.color) ? p.color.join(', ') : (p.color || '')).trim() ||
           (Array.isArray(d.color) ? d.color.join(', ') : (d.color || '')).trim(),
    category: i18n.category_vi || catVi(p.category || p.listItem?.categoryName || d.category || ''),
    categoryRaw: p.category || p.listItem?.categoryName || d.category || '',
    category1: p.category1 || '',
    category2: p.category2 || '',
    images: (d.pics && d.pics.length ? d.pics : (p.listItem?.coverImg ? JSON.parse(p.listItem.coverImg) : [])).slice(0, 9),
    brandImg: d.brandImg || null,
    skus,
    availSkus: avail,
    minCNY,
    minVND: priceVND(minCNY, brand),
    // USD (CATALOG-R1 §4D): giá chính + tiền thanh toán ở mọi locale. Listing = From sale; PDP theo SKU chọn.
    _v2: isV2,
    currency: isV2 ? 'USD' : null,
    minUsd,
    saleUsdMin: isV2 ? (Number(p.saleUsdMin) || 0) : 0,
    saleUsdMax: isV2 ? (Number(p.saleUsdMax) || 0) : 0,
    refUsdMin: isV2 ? (Number(p.refUsdMin) || 0) : 0,
    refUsdMax: isV2 ? (Number(p.refUsdMax) || 0) : 0,
    deliveryDays: (() => {
      if (!avail.length) return null;
      const mn = avail[0].minDay, mx = avail[0].maxDay;
      // W7-R2 T7: ngày thiếu/sai kiểu/min>max -> null (hiện 'chưa có thông tin giao hàng')
      // W7-R3 C2: thêm chặn số âm — cần finite và 0 <= min <= max; âm/sai -> fallback
      if (typeof mn !== 'number' || typeof mx !== 'number' || !Number.isFinite(mn) || !Number.isFinite(mx)) return null;
      if (mn < 0 || mx < 0 || mn > mx) return null;
      return { min: mn, max: mx };
    })(),
    sizeKnown,
    stockState,
    priceVerified: isV2 ? (minUsd > 0) : (Number.isFinite(priceVND(minCNY, brand)) && priceVND(minCNY, brand) > 0),
    // V2: eligibility theo stock thật của SKU + giá USD xác minh được (không cần canSell field legacy).
    canSell: isV2 ? (avail.length > 0 && minUsd > 0) : ((typeof d.canSell === 'boolean' && d.canSell) && avail.length > 0),
  };
}

/* ---------------- api (qua proxy local) ---------------- */
async function apiSrc(path){
  const r = await fetch('/api/src/' + path, {headers: {accept: 'application/json'}});
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}
async function apiShop(queryString){
  // W2.4: catalog lô 1 built-in trên server (không phải 731k v2)
  const r = await fetch('/api/shop?' + queryString, {headers: {accept: 'application/json'}});
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}
// V2 BRIDGE (20/9): feed kho mới 738k — cùng response shape {total, offset, limit, items}
async function apiShopV2(queryString){
  const r = await fetch('/api/shopv2?' + queryString, {headers: {accept: 'application/json'}});
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}
async function fetchProduct(spuId){
  const p = await apiSrc('products/' + encodeURIComponent(spuId));
  return normalizeProduct(p);
}

/* ---------------- cart (localStorage) ---------------- */
function cartRead(){
  try { const raw = localStorage.getItem(CART_KEY); if (!raw) return {lines: []};
    const d = JSON.parse(raw); return {lines: Array.isArray(d.lines) ? d.lines : []};
  } catch { return {lines: []}; }
}
function cartWrite(state){ try { localStorage.setItem(CART_KEY, JSON.stringify({lines: state.lines, updatedAt: Date.now()})); } catch {} }
// W5.6: UTM capture + funnel tracking (session/pdp/cart/place/order)
let MJ_SID = (localStorage.getItem('mj.sid') || '').slice(0,40) || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2,8));
if (!localStorage.getItem('mj.sid')) localStorage.setItem('mj.sid', MJ_SID);
if (!sessionStorage.getItem('mj.seen')) { try { localStorage.setItem('mj.sid', MJ_SID); } catch (e) {} sessionStorage.setItem('mj.seen', '1'); }
// WEB-PAY idempotency: ONE idemKey per checkout intent (browser-stable + canonical cart lines) —
// a re-click/retry on the same cart reuses the same order/payment; a changed cart gets a new key.
function checkoutIdemKey(lines) {
  const canon = (lines && lines.slice().sort((a, b) => (a.spuId + a.skuId < b.spuId + b.skuId ? -1 : 1)).map(l => l.spuId + ':' + l.skuId + 'x' + l.qty).join('|')) || '';
  let h = 0; for (let i = 0; i < canon.length; i++) { h = ((h << 5) - h + canon.charCodeAt(i)) | 0; }
  return (MJ_SID + ':' + (h >>> 0).toString(36));
}
let MJ_UTM = null;
try { MJ_UTM = JSON.parse(sessionStorage.getItem('mj.utm')) || null; } catch (e) {}
function track(type, extra){
  const payload = Object.assign({ type, sid: MJ_SID, utm: MJ_UTM }, extra || {});
  try { fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); } catch (e) {}
}
// Khi URL mang UTM -> luu cho ca phien (khong mat khi chuyen trang noi bo)
(function initUTM(){
  try {
    const q = new URLSearchParams(location.search);
    const s = q.get('utm_source'), m = q.get('utm_medium'), c = q.get('utm_campaign');
    if (s) { MJ_UTM = { source: s, medium: m || '', campaign: c || '' }; sessionStorage.setItem('mj.utm', JSON.stringify(MJ_UTM)); }
    if (s || MJ_UTM) track('session');            // 1 lan/phien nen track moi lan co UTM
  } catch (e) {}
})();
function renderDashboard(){
  showPage('home');
  const body = document.getElementById('dashboardBody') || document.getElementById('shopBody') || document.body;
  document.title = 'Bảng đo — Mandarin Jam';
  body.innerHTML = '<div class="co-success" style="text-align:left"><h3>Bảng đo funnel</h3><p style="color:#888" id="dashNote">Đang tải…</p><div id="dashGrid"></div></div>';
  fetch('/api/dashboard').then(r => r.json()).then(d => {
    if (d.error) { document.getElementById('dashNote').textContent = 'Lỗi: ' + d.error; return; }
    document.getElementById('dashNote').textContent = 'Số thật từ orders + events (server, theo ngày).';
    const card = (label, val, sub) => '<div class="dash-card"><strong>' + val + '</strong><span>' + label + '</span>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
    const g = document.getElementById('dashGrid');
    g.innerHTML = '<div class="dash-grid">' +
      card('Đơn web', d.orders) + card('Đơn có nguồn social', d.socialOrders, d.pctSocial + '%') +
      card('Phiên (session)', d.sessions) + card('Xem PDP', d.pdp) + card('Thêm giỏ', d.carts) + card('Đặt', d.places) +
      card('Chuyển đổi phiên→đơn', (d.conversion || 0) + '%', 'đơn/phiên') + card('AOV (giá trị trung bình/đơn)', fmtVND(d.aov || 0)) +
      card('Món xem / phiên', d.avgItemsPerSession || 0) + card('Tổng doanh thu', fmtVND(d.total_vi || 0)) +
      '<div class="dash-card span2"><strong>Bảng nguồn</strong><span>' + (Object.keys(d.bySource || {}).length ? Object.entries(d.bySource).map(([k, v]) => k + ': ' + v + ' đơn').join(' · ') : 'chưa có đơn social') + '</span></div>' +
      '</div>';
  }).catch(e => { document.getElementById('dashNote').textContent = 'Lỗi tải: ' + e.message; });
}
function cartAdd(prod, sku, qty){
  track('cart', { spuId: prod.spuId });
  const st = cartRead();
  const line = st.lines.find(l => l.spuId === prod.spuId && l.skuId === sku.skuId);
  if (line) line.qty = Math.min(10, line.qty + qty);
  else {
    // CATALOG-R1 §4D/§6: V2 line = giá USD theo SKU thật (currency:USD); legacy line giữ
    // priceCNY/priceVND + snapshot (đơn cũ không đổi tiền tệ). Không trộn hai currency.
    const isV2 = !!(prod && prod._v2) || !!(sku && sku.currency === 'USD');
    st.lines.push({
      spuId: prod.spuId, skuId: sku.skuId, size: sku.size,
      name: prod.name, brand: prod.brand, img: prod.images[0] || '',
      priceCNY: sku.priceCNY || 0, priceVND: isV2 ? null : priceVND(sku.priceCNY, prod.brand), qty, addedAt: Date.now(),
      currency: isV2 ? 'USD' : 'VND',
      priceUSD: isV2 ? (Number(sku.salePriceUsd) || 0) : null,
      priceRefUSD: isV2 ? (Number(sku.referencePriceUsd) || 0) : null,
    });
  }
    cartWrite(st);
  renderCartCount();
}
function cartSetQty(spuId, skuId, qty){
  const st = cartRead();
  const l = st.lines.find(x => x.spuId === spuId && x.skuId === skuId);
  if (!l) return;
  l.qty = Math.max(1, Math.min(10, qty));
  cartWrite(st); renderCartCount();
}
function cartRemove(spuId, skuId){
  const st = cartRead();
  st.lines = st.lines.filter(x => !(x.spuId === spuId && x.skuId === skuId));
  cartWrite(st); renderCartCount();
}
function linePrice(l){ // đơn giá hiển thị theo currency của dòng (USD chính cho V2, VND cho legacy)
  if (l.currency === 'USD') return (l.priceUSD != null ? l.priceUSD : 0);
  return (l.priceVND != null ? l.priceVND : priceVND(l.priceCNY, l.brand));
}
function linePriceFmt(l){ // (dòng) — trả {text, currency} để render đúng tiền
  if (l.currency === 'USD') return { text: fmtUSD((l.priceUSD || 0) * l.qty), currency: 'USD' };
  return { text: fmtVND((l.priceVND != null ? l.priceVND : priceVND(l.priceCNY, l.brand)) * l.qty), currency: 'VND' };
}
function cartTotals(){
  const st = cartRead();
  let cny = 0, vnd = 0, usd = 0;
  st.lines.forEach(l => {
    cny += (l.priceCNY || 0) * l.qty;
    if (l.currency === 'USD') { usd += (l.priceUSD || 0) * l.qty; return; }
    vnd += (l.priceVND != null ? l.priceVND : priceVND(l.priceCNY, l.brand)) * l.qty;
  });
  return {count: st.lines.reduce((a, l) => a + l.qty, 0), cny, vnd, usd, hasUsd: usd > 0, hasVnd: vnd > 0};
}
function renderCartCount(){
  const t = cartTotals();
  const el = $('#cartCount');
  if (!el) return;
  el.hidden = t.count === 0;
  el.textContent = t.count;
}

/* ---------------- card render ---------------- */
/* W1.6 — ảnh đồng nhất: card 3:4 (CSS aspect-ratio + object-fit:cover).
   Ảnh card: ưu tiên ảnh cạnh dài >=700px (đủ sắc nét, không bị mờ khi zoom 100%);
   ảnh đầu <700px hoặc lỗi → tự thử ảnh khác cùng SKU; cả SKU đều <700px →
   card bị loai khoi lo home (vẫn xem duoc o /shop + tim kiem). */
const CARD_IMG_MIN = 700; // cạnh dài tối thiểu (px) — chuẩn ảnh card
function cardImgOk(img){ return !!(img.complete && img.naturalWidth > 0 && Math.max(img.naturalWidth, img.naturalHeight) >= CARD_IMG_MIN); }
function pickSharpImage(urls, cb){
  const cand = (urls || []).slice(0, 4);
  if (!cand.length) return cb(null);
  let done = 0, best = null, bestScore = -1;
  const finish = () => { if (++done === cand.length) cb(best); };
  cand.forEach(u => {
    const im = new Image();
    im.onload = () => {
      const ls = Math.max(im.naturalWidth, im.naturalHeight);
      if (ls >= CARD_IMG_MIN && ls > bestScore) { bestScore = ls; best = u; }
      finish();
    };
    im.onerror = finish;
    im.src = u;
  });
}
function attachCardImgFix(imgEl, p, hideOnLowRes){
  if (!imgEl || !p.images.length) return;
  let fixing = false;
  const tryFix = () => {
    if (fixing || !imgEl.isConnected || cardImgOk(imgEl)) return;
    fixing = true;
    pickSharpImage(p.images.slice(1), best => {
      fixing = false;
      if (!imgEl.isConnected) return;
      if (best && best !== imgEl.getAttribute('src')) imgEl.src = best; // ảnh khác cùng SKU (sắc nét hơn)
      else if (!best && hideOnLowRes) imgEl.closest('.card') && imgEl.closest('.card').remove(); // loại khỏi lô home
      else imgEl.removeEventListener('error', tryFix); // ảnh đầu lỗi + không có ảnh khác: giữ hiện trạng (badge "Chưa có ảnh" ở lớp payload), không loop
    });
  };
  imgEl.addEventListener('load', tryFix);
  imgEl.addEventListener('error', tryFix);
  if (imgEl.complete) tryFix();
}
function cardEl(p, opts){
  const el = document.createElement('article');
  el.className = 'card';
  const img = p.images[0] || '';
  const hideOnLowRes = !!(opts && opts.hideOnLowRes);
  // W2 C4: bỏ chip category trên ảnh + dòng đếm "N size(s)" khỏi card (taxonomy nội bộ);
  // giữ trạng thái hết hàng thật (outStock), brand, tên theo locale, giá/currency không đổi.
  const eager = !!(opts && opts.eager);
  const sku = (opts && opts.matchedSku) || p.matchedSku || '';
  const href = '/product/' + p.spuId + (sku ? '?sku=' + encodeURIComponent(sku) + '&lang=' + LANG : '');
  el.innerHTML =
    '<a class="card-media" href="' + href + '" aria-label="' + esc(p.name) + '">' +
      (img ? '<img ' + (eager ? 'loading="eager"' : 'loading="lazy"') + ' width="600" height="750" src="' + esc(img) + '" alt="' + esc(p.name) + '">' : '<span class="card-badge">Chưa có ảnh</span>') +
    '</a>' +
    '<div class="card-body">' +
      '<span class="card-brand">' + esc(p.brand) + '</span>' +
      '<a class="card-title" href="' + href + '">' + esc(p.name) + '</a>' +
      // R-BRANDCODE: không hiện "SKU khớp: <skuId nội bộ>" cho khách — mã nội bộ chỉ phục vụ xử lý.
      '' +
      (!p.canSell ? '<div class="card-meta"><span>' + t('outStock') + '</span></div>' : '') +
      '<div class="card-price">' +
        '<span class="price-main">' + (p.canSell ? ((p._v2 && p.minUsd > 0) ? fmtUSD(p.minUsd) : (p.minPriceView || fmtVND(p.minVND))) : '—') + '</span>' +
        ((p._v2 && p.canSell && p.refUsd > p.minUsd) ? '<span class="price-ref">' + esc(fmtUSD(p.refUsd)) + '</span><span class="price-pct">' + esc(discountPct(p.minUsd, p.refUsd)) + '</span>' : '') +
      '</div>' +
    '</div>';
  attachCardImgFix(el.querySelector('.card-media img'), p, hideOnLowRes);
  return el;
}
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------------- router ---------------- */
// W2.5: cập nhật OG meta khi đổi route (share Zalo/FB có ảnh bìa)
function setOG(title, image, url){
  const abs = u => u && !/^https?:/.test(u) ? location.origin + u : u;
  const set = (prop, content) => {
    let el = document.querySelector('meta[property="' + prop + '"]');
    if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
    el.setAttribute('content', content || '');
  };
  set('og:title', title || document.title);
  set('og:description', document.querySelector('meta[name="description"]')?.content || title || '');
  set('og:image', abs(image) || location.origin + '/assets/logo/owner-logo-white.png');
  set('og:url', abs(url || location.pathname));
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', title || document.title);
  document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', abs(image) || location.origin + '/assets/logo/owner-logo-white.png');
}
const pages = {};
function showPage(id){
  $$('.page').forEach(p => p.hidden = true);
  const pg = $('#page-' + id);
  if (pg) pg.hidden = false;
  window.scrollTo(0, 0);
  const nav = $$('.header-nav a');
  nav.forEach(a => a.style.color = '');
  const shopLink = nav.find(a => (a.getAttribute('href') || '').indexOf('/shop') === 0);
  if (id === 'shop' && shopLink) shopLink.style.color = 'var(--accent)';
}
async function route(){
  // W5 R2 4.3: rời home cancel animation (không tiêu thụ); về home tái observe với layout hiện tại
  if (window.__mjFooterMotion) {
    if (location.pathname !== '/') window.__mjFooterMotion.finishStatic();
    if (window.__mjFooterMotionRecheck) window.__mjFooterMotionRecheck();
  }
  const path = location.pathname;
  if (path.startsWith('/product/')) { const id = path.split('/')[2]; if (id) { showPage('product'); return renderPDP(id); } }
  if (path === '/shop') { showPage('shop'); return renderShop(); }
  if (path === '/about') { showPage('about'); document.title = 'Về chúng tôi — Mandarin Jam'; return; }
  if (path === '/cart') { showPage('cart'); return renderCart(); }
  if (path === '/checkout') { showPage('checkout'); return renderCheckout(); }
  if (path.startsWith('/order/')) { const oid = path.split('/')[2]; if (oid) return renderOrderStatus(decodeURIComponent(oid)); }
  if (path === '/legal' || /^\/legal\/[a-z0-9-]+$/.test(path)) { showPage('legal'); return renderLegal(path === '/legal' ? undefined : path.split('/')[2]); }
  if (path === '/dashboard') { showPage('home'); renderDashboard(); return; }
  if (path === '/order-request') { showPage('order'); return renderOrderRequest(); }
  if (path === '/' || path === '') setOG(null, '/assets/logo/owner-logo-white.png', '/');
  showPage('home');
  return renderHome();
}

/* ---------------- HOME ---------------- */
// R2.1: display label đa ngôn ngữ cho facet home strip. Query vẫn dùng giá trị facet gốc (canonical),
// không dịch query value; chỉ nhóm nào có nhãn ngắn ĐÚNG nghĩa mới lên strip, còn lại để shop filter đầy đủ.
const CATEGORY_LABELS = {
  'Áo': { vi: 'Áo', en: 'Tops', zh: '上装', ko: '상의' },
  'Áo hoodie / Áo len': { vi: 'Áo hoodie / Áo len', en: 'Hoodies & knitwear', zh: '卫衣·针织', ko: '후디·니트' },
  'Áo khoác / Jacket': { vi: 'Áo khoác / Jacket', en: 'Jackets & coats', zh: '夹克·外套', ko: '재킷·아우터' },
  'Áo khoác dài / Áo phao': { vi: 'Áo khoác dài / Áo phao', en: 'Coats & padding', zh: '大衣·羽绒服', ko: '코트·패딩' },
  'Áo polo / Áo thun / Áo': { vi: 'Áo polo / Áo thun / Áo', en: 'Polos & tees', zh: '上衣', ko: '상의' },
  'Áo sơ mi': { vi: 'Áo sơ mi', en: 'Shirts', zh: '衬衫', ko: '셔츠' },
  'Bộ đồ': { vi: 'Bộ đồ', en: 'Sets', zh: '套装', ko: '세트' },
  'Bốt / Giày cổ cao': { vi: 'Bốt & giày cổ cao', en: 'Boots & high-tops', zh: '短靴·高帮鞋', ko: '부츠·하이탑' },
  'Dép / Sandal': { vi: 'Dép / Sandal', en: 'Sandals & slippers', zh: '凉鞋·拖鞋', ko: '샌들·슬리퍼' },
  'Đồ bơi': { vi: 'Đồ bơi', en: 'Swimwear', zh: '泳装', ko: '수영복' },
  'Giày bệt': { vi: 'Giày bệt', en: 'Flats', zh: '平底鞋', ko: '플랫' },
  'Giày cao gót': { vi: 'Giày cao gót', en: 'Heels', zh: '高跟鞋', ko: '하이힐' },
  'Giày công sở': { vi: 'Giày công sở', en: 'Dress shoes', zh: '正装鞋', ko: '구두' },
  'Giày thể thao': { vi: 'Giày thể thao', en: 'Sneakers', zh: '运动鞋', ko: '스니커즈' },
  'Khăn choàng / Khăn lụa': { vi: 'Khăn choàng / Khăn lụa', en: 'Scarves', zh: '围巾·丝巾', ko: '스카프' },
  'Kính râm': { vi: 'Kính râm', en: 'Sunglasses', zh: '太阳镜', ko: '선글라스' },
  'Mũ': { vi: 'Mũ', en: 'Hats', zh: '帽子', ko: '모자' },
  'Phụ kiện khác': { vi: 'Phụ kiện khác', en: 'Accessories', zh: '其他配饰', ko: '기타 액세서리' },
  'Quần dài': { vi: 'Quần dài', en: 'Trousers', zh: '长裤', ko: '바지' },
  'Quần jean': { vi: 'Quần jean', en: 'Jeans', zh: '牛仔裤', ko: '청바지' },
  'Quần short': { vi: 'Quần short', en: 'Shorts', zh: '短裤', ko: '반바지' },
  'Thắt lưng': { vi: 'Thắt lưng', en: 'Belts', zh: '腰带', ko: '벨트' },
  'Trang sức': { vi: 'Trang sức', en: 'Jewelry', zh: '首饰', ko: '주얼리' },
  'Túi đeo vai / Túi chéo': { vi: 'Túi đeo vai / Túi chéo', en: 'Shoulder & crossbody bags', zh: '单肩·斜挎包', ko: '숄더·크로스백' },
  'Túi xách tay': { vi: 'Túi xách tay', en: 'Handbags', zh: '手提包', ko: '핸드백' },
  'Túi xách tay / Túi mini': { vi: 'Túi xách tay / Túi mini', en: 'Mini & clutch bags', zh: '手拿·迷你包', ko: '클러치·미니백' },
  'Váy / Chân váy': { vi: 'Váy / Chân váy', en: 'Dresses & skirts', zh: '裙装', ko: '원피스·스커트' },
  'Ví': { vi: 'Ví', en: 'Wallets', zh: '钱包', ko: '지갑' },
  'Ví chìa khóa / Móc khóa': { vi: 'Ví chìa khóa / Móc khóa', en: 'Key holders', zh: '钥匙包·扣', ko: '키홀더' },
};
/* STOREFRONT 4A: department nav — nhãn hàng dùng chữ EN cố định (fashion nav, không dịch),
   nhưng aria/title + heading theo locale. Click dept = mở lựa chọn department MỚI, xóa filter cũ. */
const DEPT_LABELS = { men: { vi:'Nam', en:'Men', zh:'男士', ko:'남성' }, women: { vi:'Nữ', en:'Women', zh:'女士', ko:'여성' }, kids: { vi:'Trẻ em', en:'Kids', zh:'儿童', ko:'키즈' } };
function deptLabel(d){ return DEPT_LABELS[d] && DEPT_LABELS[d][LANG] || (d || ''); }
function syncDeptNav(){
  document.querySelectorAll('.header-nav a[data-dept]').forEach(a => {
    const d = a.getAttribute('data-dept');
    if (shopState.dept === d) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.drawer-nav a[data-dept]').forEach(() => {}); // drawer không có dept
}
function setDepartment(d){
  // bắt đầu lựa chọn department mới: xóa q/brand/cat/price/offset, sort default (STOREFRONT 4A)
  shopState.q=''; shopState.brand=''; shopState.catPath=[]; shopState.priceMin=0; shopState.priceMax=0; shopState.sort='default'; shopState.dept=d;
  const u = new URL(location.origin + '/shop');
  u.searchParams.set('lang', LANG);
  if (d) u.searchParams.set('department', d);
  history.pushState({}, '', u.pathname + u.search);
  route();
}

// W1 S1: handle liên hệ thật (từ live mandarinjam.club 19/9) — trước đây MJ_ZALO/MJ_GROUP
// không được gán ở đâu, nút "Hỏi Quýt" dẫn tới zalo.me/ rỗng. Không thay đổi dữ liệu/giá.
const MJ_ZALO_HANDLE = '3481730554380561086'; // Zalo người bán (OA)
const MJ_GROUP_HANDLE = 'eh1cvkrurimcu4num0qj'; // Nhóm Zalo Mandarin Jam (từ live)
window.MJ_ZALO = '3481730554380561086';
window.MJ_GROUP = 'eh1cvkrurimcu4num0qj';
/* W6 4.1: hero spec chốt bởi PMO — map theo ID + image URL; window chỉ cắt lề trắng
   qua SVG viewBox (không crop raster, không edit pixel). Sai URL/kích thước -> bỏ crop, báo ASSET_CHANGED. */
const HERO_SPEC = [
  { id: '32022458', role: 'main', img: '/img/7de03ea3d4ad3847f1ed702da3a82f1a16ddc296', natural: [1605, 1929], win: [273, 665, 1061, 929] },
  { id: '33605678', role: 'side', img: '/img/f58d78344b65ddbaea995f0852ced78f3bb04233', natural: [1334, 1604], win: [237, 922, 883, 408] },
  { id: '34647931', role: 'side', img: '/img/8270f3cea38920f5419739f7a0e21e5e3030904c', natural: [610, 734], win: [60, 25, 495, 690] },
];
const HERO_EXCLUDE = new Set(['23489442']); // túi FRONT — loại khỏi home (vẫn ở shop/PDP)

/* W7-R2 B1: display label whitelist theo locale — raw size/SKU/ID và classification nguồn KHÔNG đổi.
   Nhãn không có trong whitelist: hiển thị raw, bỏ khỏi dòng category ở locale không có mapping. */
const SIZE_LOCALE = {
  '均码': { vi: 'Một cỡ', en: 'One size', zh: '均码', ko: '원 사이즈' }
};
const CATEGORY_LOCALE = {
  'POLO/T恤/上衣': { vi: 'Áo polo / Áo thun / Áo', en: 'Tops', zh: '上衣', ko: '상의' },
  '上衣': { vi: 'Áo', en: 'Tops', zh: '上装', ko: '상의' },
  '太阳镜': { vi: 'Kính râm', en: 'Sunglasses', zh: '太阳镜', ko: '선글라스' },
  '帽子': { vi: 'Mũ', en: 'Hats', zh: '帽子', ko: '모자' },
  '服装': { vi: 'Trang phục', en: 'Clothing', zh: '服装', ko: '의류' },
  '配饰': { vi: 'Phụ kiện', en: 'Accessories', zh: '配饰', ko: '액세서리' },
  '单肩包/斜挎包': { vi: 'Túi đeo vai / Túi chéo', en: 'Shoulder & crossbody bags', zh: '单肩·斜挎包', ko: '숄더·크로스백' },
  '裙装': { vi: 'Váy / Chân váy', en: 'Dresses & skirts', zh: '裙装', ko: '원피스·스커트' },
  '凉鞋/拖鞋': { vi: 'Dép / Sandal', en: 'Sandals & slippers', zh: '凉鞋·拖鞋', ko: '샌들·슬리퍼' },
  '靴子/高帮鞋': { vi: 'Bốt / Giày cổ cao', en: 'Boots & high-tops', zh: '靴子·高帮鞋', ko: '부츠·하이탑' },
  '钱包': { vi: 'Ví', en: 'Wallets', zh: '钱包', ko: '지갑' },
  '衬衫': { vi: 'Áo sơ mi', en: 'Shirts', zh: '衬衫', ko: '셔츠' },
  '卫衣/针织衫': { vi: 'Áo hoodie / Áo len', en: 'Hoodies & knitwear', zh: '卫衣·针织', ko: '후디·니트' },
  '套装': { vi: 'Bộ đồ', en: 'Sets', zh: '套装', ko: '세트' },
  '首饰': { vi: 'Trang sức', en: 'Jewelry', zh: '首饰', ko: '주얼리' },
  '休闲/运动鞋': { vi: 'Giày thể thao', en: 'Sneakers', zh: '运动鞋', ko: '스니커즈' },
  '夹克/外套': { vi: 'Áo khoác / Jacket', en: 'Jackets & coats', zh: '夹克·外套', ko: '재킷·아우터' },
  '皮带/腰带': { vi: 'Thắt lưng', en: 'Belts', zh: '腰带', ko: '벨트' },
  '短裤': { vi: 'Quần short', en: 'Shorts', zh: '短裤', ko: '반바지' },
  '牛仔裤': { vi: 'Quần jean', en: 'Jeans', zh: '牛仔裤', ko: '청바지' },
  '泳装': { vi: 'Đồ bơi', en: 'Swimwear', zh: '泳装', ko: '수영복' },
  '钥匙包/钥匙扣': { vi: 'Ví chìa khóa / Móc khóa', en: 'Key holders', zh: '钥匙包·扣', ko: '키홀더' },
  '高跟鞋': { vi: 'Giày cao gót', en: 'Heels', zh: '高跟鞋', ko: '하이힐' },
  '平底鞋/便鞋': { vi: 'Giày bệt', en: 'Flats', zh: '平底鞋', ko: '플랫' },
  '商务正装鞋': { vi: 'Giày công sở', en: 'Dress shoes', zh: '正装鞋', ko: '구두' },
  '围巾/丝巾': { vi: 'Khăn choàng / Khăn lụa', en: 'Scarves', zh: '围巾·丝巾', ko: '스카프' },
  '大衣/羽绒服': { vi: 'Áo khoác dài / Áo phao', en: 'Coats & padding', zh: '大衣·羽绒服', ko: '코트·패딩' },
  '手拿包/迷你包': { vi: 'Túi xách tay / Túi mini', en: 'Mini & clutch bags', zh: '手拿·迷你包', ko: '클러치·미니백' },
  '手提包': { vi: 'Túi xách tay', en: 'Handbags', zh: '手提包', ko: '핸드백' },
  '短裤/裤装': { vi: 'Quần short', en: 'Shorts', zh: '短裤', ko: '반바지' }
};

let __homeGen = 0;
let __homeLoading = false;
function verifyHeroImage(spec, raw){
  return new Promise((resolve) => {
    const firstImg = (raw.img || [])[0] || '';
    if (firstImg !== spec.img) { resolve({ crop: false, reason: 'URL_MISMATCH', img: firstImg }); return; }
    const im = new Image();
    im.onload = () => {
      const ok = im.naturalWidth === spec.natural[0] && im.naturalHeight === spec.natural[1];
      resolve({ crop: ok, reason: ok ? 'OK' : 'NATURAL_DIMS_MISMATCH', img: firstImg, nw: im.naturalWidth, nh: im.naturalHeight });
    };
    im.onerror = () => resolve({ crop: false, reason: 'IMAGE_LOAD_FAIL', img: firstImg });
    im.src = firstImg;
  });
}
async function renderHome(){
  const gen = ++__homeGen;
  document.title = 'Mandarin Jam — Thời trang & phụ kiện';
  const grid = $('#featuredGrid');
  const heroBox = $('#heroMedia');
  if (heroBox) heroBox.setAttribute('aria-busy', 'true');
  try {
    if (__homeLoading) return; // chặn duplicate retry
    __homeLoading = true;
    const d = await apiShop('limit=280&offset=0');
    if (gen !== __homeGen) { __homeLoading = false; return; } // generation guard khi route/locale đổi lúc chờ
    const byId = {};
    const pool = [];
    const seen = new Set();
    for (const raw of d.items) {
      const id = String(raw.spuId);
      byId[id] = raw;
      if (!seen.has(id) && (raw.img || []).length) { seen.add(id); pool.push(raw); }
    }
    // B3: verify 3 hero bằng URL + decode + natural dimensions (không crop tạm)
    window.__heroAssetChanged = [];
    const verified = [];
    for (const spec of HERO_SPEC) {
      const raw = byId[spec.id];
      if (!raw) { window.__heroAssetChanged.push({ id: spec.id, reason: 'ID_NOT_IN_CATALOG' }); continue; }
      const v = await verifyHeroImage(spec, raw);
      if (v.reason !== 'OK') window.__heroAssetChanged.push({ id: spec.id, reason: v.reason, served: v.img, expected: spec.img, nw: v.nw, nh: v.nh });
      verified.push({ spec, raw, crop: v.crop, reason: v.reason });
    }
    if (gen !== __homeGen) { __homeLoading = false; return; }
    // chọn tile hợp lệ; mất main -> món hợp lệ đầu tiên lên main
    const good = verified.filter(v => v.raw && v.reason !== 'IMAGE_LOAD_FAIL');
    const hasMain = good.some(v => v.spec.role === 'main');
    let tiles = good;
    if (!hasMain && good.length) {
      const first = good[0];
      tiles = [{ ...first, spec: { ...first.spec, role: 'main', win: first.spec.win } }, ...good.slice(1)];
    }
    const hero = tiles.map(v => v.raw);
    // render hero theo count, giữ composition khi đủ 3
    if (heroBox) {
      heroBox.innerHTML = '';
      heroBox.removeAttribute('hidden');
      heroBox.dataset.count = String(tiles.length);
      const cap = (card, cls) =>
        '<span class="' + cls + '-cap"><span class="' + cls + '-brand">' + esc(card.brand) + '</span>' +
        '<span class="' + cls + '-name">' + esc(card.name) + '</span>' +
        '<span class="' + cls + '-price">' + esc(card.minPriceView || fmtVND(card.minVND)) + '</span></span>';
      tiles.forEach(({ spec, raw, crop, reason }) => {
        const c = lot1Card(raw);
        const isMain = spec.role === 'main';
        const cls = isMain ? 'hero-main' : 'hero-side';
        const mediaCls = isMain ? 'hero-main-media' : 'hero-side-media';
        let media;
        if (crop) {
          media = '<svg viewBox="' + spec.win.join(' ') + '" preserveAspectRatio="' + (isMain ? 'xMidYMin' : 'xMidYMid') + ' meet" focusable="false" aria-hidden="true">' +
            '<image href="' + esc(spec.img) + '" width="' + spec.natural[0] + '" height="' + spec.natural[1] + '"/></svg>';
        } else {
          // ảnh hợp lệ nhưng URL/kích thước khác: contain, không stretch/cover
          media = '<img loading="eager" src="' + esc((raw.img || [])[0] || '') + '" alt="' + esc(c.name) + '" class="hero-img">';
        }
        heroBox.insertAdjacentHTML('beforeend',
          '<a class="' + cls + '" href="/product/' + c.spuId + '" aria-label="' + esc(c.name) + '">' +
            '<span class="' + mediaCls + '">' + media + '</span>' + cap(c, cls) + '</a>');
      });
      if (!tiles.length) heroBox.setAttribute('hidden', ''); // zero món: ẩn media
      window.__heroIds = hero.map(r => String(r.spuId));
      window.__heroMeta = tiles.map(v => ({ spuId: String(v.raw.spuId), brand: v.raw.brand || '', category: v.raw.category || '', cropped: v.crop, reason: v.reason }));
    }
    // Featured: max 4 unique, cap 2/brand, không trùng hero, 23489442 tuyệt đối không xuất hiện
    const heroSet = new Set(hero.map(r => String(r.spuId)));
    heroSet.add('23489442');
    const extra = [];
    const exBrand = {}, exIds = new Set();
    for (const r of pool) { if (extra.length >= 4) break;
      const id = String(r.spuId), b = (r.brand || '').toLowerCase();
      if (heroSet.has(id) || exIds.has(id) || (exBrand[b] || 0) >= 2) continue;
      exBrand[b] = (exBrand[b] || 0) + 1; exIds.add(id); extra.push(r); }
    grid.innerHTML = ''; // bỏ loading trước khi render
    extra.forEach((raw, i) => grid.appendChild(cardEl(lot1Card(raw), { hideOnLowRes: true, eager: i < 4 })));
    window.__homeIds = extra.map(r => String(r.spuId));
  } catch (e) {
    // API lỗi: kết thúc aria-busy, thông báo ngắn theo locale + nút thử lại (chặn trùng)
    if (heroBox) { heroBox.innerHTML = ''; heroBox.setAttribute('hidden', ''); }
    const MSG = { vi: 'Chưa thể tải sản phẩm. Vui lòng thử lại.', en: 'Unable to load products. Please try again.', zh: '暂时无法加载商品，请重试。', ko: '상품을 불러올 수 없습니다. 다시 시도해 주세요.' };
    grid.innerHTML = '<div class="shop-empty"><h3>' + esc((MSG[LANG] || MSG.vi)) + '</h3>' +
      '<button type="button" class="btn btn-primary" id="homeRetry">' + esc(t('pdp_retry')) + '</button></div>';
    const rt = $('#homeRetry');
    if (rt) rt.addEventListener('click', () => { __homeLoading = false; renderHome(); });
  } finally {
    if (heroBox) heroBox.setAttribute('aria-busy', 'false');
    __homeLoading = false;
  }
  langifyLinks();
}

/* ---------------- SHOP ---------------- */
// W2.4: raw item từ /api/shop (catalog lô 1) -> shape cardEl
// CATALOG-R1 §4D: V2 item có currency=USD + saleUsdMin/refUsdMin (dollar) — card hiển thị
// USD chính + reference gạch + % giảm (đúng từng SKU), KHÔNG chạy CNY×4000×margin.
function lot1Card(raw){
  const isV2 = !!(raw._v2 || (raw.currency === 'USD'));
  // V2: USD thẳng từ customer DTO — hasPair false thì KHÔNG dựng reference/% giả
  const saleUsd = Number(raw.saleUsdMin) || 0;
  const refUsd = (raw.hasPair ? Number(raw.refUsdMin) || 0 : 0);
  const isSell = isV2 ? saleUsd > 0 : (Number(raw.price_vi) || Number(raw.price_vnd) || 0) > 0;
  // legacy lot1: giá VND theo công thức cũ
  const viPrice = Number(raw.price_vi) || Number(raw.price_vnd) || 0;
  return {
    spuId: Number(raw.spuId),
    name: langName(raw),
    brand: raw.brand || '',
    category: raw.category || '',
    images: raw.img || [],
    canSell: isSell,
    _v2: isV2,
    currency: isV2 ? 'USD' : null,
    minUsd: saleUsd,
    refUsd: refUsd > saleUsd ? refUsd : 0,   // reference chỉ hiện khi > sale (không % âm/giả)
    minVND: viPrice,
    minPriceView: isV2 ? null : langPrice(raw), // V2: cardEl render USD pair, không dùng view cũ
    price_vi: raw.price_vi, price_en: raw.price_en, price_ko: raw.price_ko, price_zh: raw.price_zh,
    availSkus: isSell ? [{size:''}] : [],
    delivery: null,
    descVn: langDesc(raw),
    name_zh: raw.name_zh || '', name_en: raw.name_en || '', name_ko: raw.name_ko || '',
  };
}
const shopState = { offset: 0, shown: 0, q: '', dept: '', catPath: [], brand: '', priceMin: 0, priceMax: 0, sort: 'default', total: 0, limit: 24 };
// SHOP-R1 4.5: một nguồn appliedState (shopState) — desktop áp ngay; mobile commit qua dialog.
// CATALOG-R1 B.1/B.3: facets từ /api/shopv2/config (filter-config V2, TTL server 10') —
// department tree + brands{id,label,count}. KHÔNG lấy 280 SPU cũ để dựng facet.
let V2C = null;              // {departments, tree{Dept: {Cat: [Type]}}, counts, brands[]}
let V2C_PROMISE = null;
async function v2Config(){
  if (V2C) return V2C;
  if (!V2C_PROMISE) {
    V2C_PROMISE = fetch('/api/shopv2/config', { headers: { accept: 'application/json' } })
      .then(r => { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
      .then(d => { if (!d || !d.tree) throw new Error('config malformed'); V2C = d; return V2C; })
      .catch(e => { V2C_PROMISE = null; throw e; });
  }
  return V2C_PROMISE;
}
const DEPT_KEYS = ['women', 'men', 'kids'];
const DEPT_TOKEN = { women: 'Women', men: 'Men', kids: 'Kids' };
function deptToken(d){ return DEPT_TOKEN[String(d || '').toLowerCase()] || ''; }
function tokenDept(tok){ const m = { Women: 'women', Men: 'men', Kids: 'kids', Unisex: 'unisex' }; return m[String(tok || '')] || ''; }
function deptOptions(){ return (V2C ? V2C.departments : []).map(tok => ({ tok, key: tokenDept(tok) })).filter(x => x.key); }
function catOptions(dept){
  const t = (V2C && V2C.tree) || {};
  if (dept && t[dept]) return Object.keys(t[dept]).sort((a, b) => a.localeCompare(b));
  const out = new Map();
  Object.entries(t).forEach(([d, cats]) => Object.keys(cats).forEach(c => { if (!out.has(c)) out.set(c, d); }));
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(x => x[0]);
}
function typeOptions(dept, cat){
  const t = (V2C && V2C.tree) || {};
  return ((t[dept] || {})[cat] || []).slice().sort((a, b) => a.localeCompare(b));
}
function v2Count(key, map){ const n = (V2C && V2C.counts && V2C.counts[map] && V2C.counts[map][key]); return Number(n) || 0; }
function brandById(id){ const b = ((V2C && V2C.brands) || []).find(x => String(x.id) === String(id)); return b || null; }
function brandLabel(id){ const b = brandById(id); return b ? b.label : String(id); }
function deptCountLabel(tok){ const n = v2Count(tok, 'dept'); return n ? new Intl.NumberFormat(localeOf()).format(n) : ''; }
function catCountLabel(dept, cat){ const n = v2Count((dept || cat) + (dept ? '/' + cat : ''), dept ? 'cat' : null); return n ? new Intl.NumberFormat(localeOf()).format(n) : ''; }
function fmtCount(n){ return Number(n) ? new Intl.NumberFormat(localeOf()).format(n) : ''; }

function shopFilterParams(o){
  o = o || {};
  const st = o.catPath ? o : shopState;
  const sp = new URLSearchParams({ limit: String(o.limit || shopState.limit), offset: String(o.offset != null ? o.offset : (o.reset ? 0 : shopState.offset)) });
  if (o.q != null) { if (o.q) sp.set('q', o.q); } else if (shopState.q) sp.set('q', shopState.q);
  const dept = o.catPath ? (o.dept || deptToken(o.catPath[0])) : (shopState.dept || deptToken(shopState.catPath[0]));
  if (dept) sp.set('department', dept);
  const segs = o.catPath || shopState.catPath || [];
  const cs = segs.slice(1).filter(Boolean);   // segment 0 = department (bridge đã map)
  if (cs.join('+')) sp.set('cat', cs.join('+'));
  if (o.brand != null) { if (o.brand) sp.set('brand', o.brand); } else if (shopState.brand) sp.set('brand', shopState.brand);
  const pmin = o.priceMin != null ? o.priceMin : shopState.priceMin;
  const pmax = o.priceMax != null ? o.priceMax : shopState.priceMax;
  if (Number(pmin) > 0) sp.set('minPrice', String(pmin));
  if (Number(pmax) > 0) sp.set('maxPrice', String(pmax));
  const sort = o.sort != null ? o.sort : shopState.sort;
  if (sort && sort !== 'default') sp.set('sort', sort);
  return sp;
}
function shopStateFromUrl(u){
  const st = { q: u.get('q') || '', dept: '', catPath: [], brand: '', priceMin: 0, priceMax: 0, sort: 'default' };
  const dep = u.get('department');
  if (dep && deptToken(dep)) st.dept = dep;
  const c = u.get('cat');
  if (c) { const segs = c.split('+').filter(Boolean); if (segs.length) st.catPath = segs; if (st.dept && st.catPath[0] !== deptToken(st.dept)) st.catPath = [deptToken(st.dept)].concat(segs); }
  const b = u.get('brand');
  if (b && !Number.isNaN(parseInt(b, 10))) st.brand = String(parseInt(b, 10));
  const pmin = parseFloat(u.get('minPrice')), pmax = parseFloat(u.get('maxPrice'));
  if (Number.isFinite(pmin) && pmin > 0) st.priceMin = pmin;
  if (Number.isFinite(pmax) && pmax > 0) st.priceMax = pmax;
  const s = u.get('sort');
  if (s === 'price-asc' || s === 'price-desc') st.sort = s;
  return st;
}

let dialogDraft = null;      // draft khi panel mở: {dept, catPath, brand, priceMin, priceMax}
let fpOpen = false;
let fpLastFocus = null;
let brandMore = false;
let brandQuery = '';
let fpCountSeq = 0;
const BRAND_CAP = 30;
// CATALOG-R1 B.4: request generation — load-more/response cũ (đời trước) không ghi đè grid.
let shopReqSeq = 0;
// debounce nhẹ cho brand search trong panel (không cần thư viện)
function debounce(fn, ms){ let t; return function(){ clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms); }; }
function draftFromState(){
  return {
    dept: shopState.dept || '',
    catPath: (shopState.catPath || []).slice(),
    brand: shopState.brand || '',
    priceMin: shopState.priceMin || 0,
    priceMax: shopState.priceMax || 0,
  };
}
function fpChip(label, on, extra){
  extra = extra || {};
  const dis = extra.disabled ? ' disabled' : '';
  return '<button type="button" class="fp-chip' + (on ? ' on' : '') + '"' + (extra.id ? ' id="' + extra.id + '"' : '') +
    ' aria-pressed="' + (on ? 'true' : 'false') + '"' + (extra.data1 ? ' data-fp1="' + esc(extra.data1) + '"' : '') +
    (extra.data2 ? ' data-fp2="' + esc(extra.data2) + '"' : '') + dis + '>' +
    '<span class="fp-chip-label">' + esc(label) + (extra.count ? ' <span class="fp-chip-count">' + esc(extra.count) + '</span>' : '') + '</span></button>';
}
function renderPanel(){
  const body = $('#fpBody'); if (!body || !dialogDraft) return;
  const d = dialogDraft;
  const deptTok = deptToken(d.dept);
  const cats = deptTok ? catOptions(deptTok) : catOptions();
  const atType = d.catPath.length >= 2;
  const types = atType ? typeOptions(deptTok, d.catPath[1]) : [];
  const f = brandQuery.trim().toLowerCase();
  const brands = ((V2C && V2C.brands) || []).filter(b => !f || (b.label || '').toLowerCase().includes(f));
  const showBrands = brands.slice(0, BRAND_CAP);
  const catLabelTxt = d.catPath.length ? d.catPath.slice(1).join(' / ') : (t('f_cat_all'));
  let html = '';
  // 1) Department
  html += '<div class="fp-group"><h3 class="fp-group-title" data-i18n="f_dept">' + esc(t('f_dept')) + '</h3><div class="fp-chips">';
  html += fpChip(t('f_cat_all'), d.dept === '', { data1: 'dept:all' });
  deptOptions().forEach(o => { html += fpChip(o.tok[0].toUpperCase() + o.tok.slice(1), d.dept === o.key, { count: deptCountLabel(o.tok), data1: 'dept:' + o.key }); });
  html += '</div></div>';
  // 2) Category (theo department chọn) + 3) Type
  if (atType) {
    html += '<div class="fp-group"><div class="fp-group-head"><button type="button" class="fp-back" data-fpact="back">← ' + esc(t('f_back')) + '</button><h3 class="fp-group-title" data-i18n="f_type">' + esc(t('f_type')) + '</h3></div><div class="fp-chips">';
    html += fpChip(t('f_cat_all'), d.catPath.length === 2, { data1: 'type:all' });
    types.forEach(tp => { html += fpChip(tp, d.catPath[2] === tp, { data1: 'type:' + tp }); });
    html += '</div></div>';
  } else {
    html += '<div class="fp-group"><h3 class="fp-group-title" data-i18n="f_cat2">' + esc(t('f_cat2')) + '</h3><div class="fp-chips">';
    html += fpChip(t('f_cat_all'), d.catPath.length === 1, { data1: 'cat:all' });
    cats.slice(0, 40).forEach(c => { html += fpChip(c, d.catPath[1] === c, { data1: 'cat:' + c, disabled: !deptTok }); });
    if (cats.length > 40) html += '<p class="fp-hint">' + esc(t('f_hint_dept')) + '</p>';
    html += '</div></div>';
  }
  // 4) Brand (search + cap 30)
  html += '<div class="fp-group"><h3 class="fp-group-title" data-i18n="f_brand">' + esc(t('f_brand')) + '</h3>' +
    '<input type="search" class="fp-search" id="fpBrandSearch" placeholder="' + esc(t('f_search_brand')) + '" value="' + esc(brandQuery) + '" autocomplete="off" aria-label="' + esc(t('f_search_brand')) + '">' +
    '<div class="fp-chips">';
  html += fpChip(t('f_cat_all'), d.brand === '');
  showBrands.forEach(b => { html += fpChip(b.label, String(d.brand) === String(b.id), { data1: 'brand:' + b.id }); });
  if (!brands.length) html += '<p class="fp-hint">—</p>';
  html += (brands.length > BRAND_CAP && !f ? '<button type="button" class="fp-more" data-fpact="brandmore">' + esc(brandMore ? t('f_collapse') : t('f_more') + ' (' + brands.length + ')') + '</button>' : '');
  html += '</div></div>';
  // 5) Price — 2 ô USD (mặc định app source)
  html += '<div class="fp-group"><h3 class="fp-group-title" data-i18n="f_price">' + esc(t('f_price')) + '</h3>' +
    '<div class="fp-price-row">' +
    '<label class="fp-price-field"><span>' + esc(t('f_price_min')) + '</span><input type="number" min="0" step="1" inputmode="decimal" id="fpPriceMin" value="' + (d.priceMin || '') + '"></label>' +
    '<span class="fp-price-dash" aria-hidden="true">–</span>' +
    '<label class="fp-price-field"><span>' + esc(t('f_price_max')) + '</span><input type="number" min="0" step="1" inputmode="decimal" id="fpPriceMax" value="' + (d.priceMax || '') + '"></label>' +
    '</div><p class="fp-price-err" id="fpPriceErr" hidden>' + esc(t('f_price_err')) + '</p>' +
    '</div>';
  html += '<p class="fp-support"><a href="#contact">' + esc(t('filter_support')) + '</a> — ' + esc(t('filter_support2')) + ' ↗</p>';
  body.innerHTML = html;
  body.querySelectorAll('[data-fp1]').forEach(b => {
    b.onclick = () => {
      const v = b.getAttribute('data-fp1');
      if (v.startsWith('dept:')) {
        const k = v.slice(5);
        if (k === 'all') {
          if (!dialogDraft.dept) return;
          dialogDraft.dept = ''; dialogDraft.catPath = []; dialogDraft.brand = '';
          brandQuery = ''; brandMore = false; renderPanel();
        } else if (dialogDraft.dept !== k) {
          dialogDraft.dept = k; dialogDraft.catPath = []; dialogDraft.brand = '';   // đổi department xoá cat/brand cũ
          brandQuery = ''; brandMore = false; renderPanel();
        }
      } else if (v === 'cat:all') {
        if (dialogDraft.catPath.length <= 1) return;
        dialogDraft.catPath = dialogDraft.catPath.length >= 1 ? [dialogDraft.catPath[0]] : [];
        renderPanel();
      } else if (v.startsWith('cat:')) {
        const c = v.slice(4);
        const deptTok2 = deptToken(dialogDraft.dept);
        if (!deptTok2) return;
        dialogDraft.catPath = [deptTok2, c];
        renderPanel();
      } else if (v === 'type:all') {
        if (dialogDraft.catPath.length <= 2) return;
        dialogDraft.catPath = dialogDraft.catPath.slice(0, 2);
        renderPanel();
      } else if (v.startsWith('type:')) {
        const tp = v.slice(5);
        const deptTok2 = deptToken(dialogDraft.dept);
        if (!deptTok2 || dialogDraft.catPath.length < 2) return;
        dialogDraft.catPath = [deptTok2, dialogDraft.catPath[1], (dialogDraft.catPath[2] === tp ? '' : tp)];
        renderPanel();
      } else if (v.startsWith('brand:')) {
        const id = v.slice(6);
        dialogDraft.brand = (String(dialogDraft.brand) === String(id)) ? '' : id;
        renderPanel();
      }
    };
  });
  const back = body.querySelector('[data-fpact="back"]');
  if (back) back.onclick = () => { dialogDraft.catPath = dialogDraft.catPath.slice(0, 1); renderPanel(); };
  const more = body.querySelector('[data-fpact="brandmore"]');
  if (more) more.onclick = () => { brandMore = !brandMore; renderPanel(); };
  const bs = $('#fpBrandSearch');
  if (bs) bs.oninput = debounce(() => { brandQuery = bs.value; renderPanel(); const n = $('#fpBrandSearch'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 150);
  ['fpPriceMin', 'fpPriceMax'].forEach(id => {
    const el = $('#' + id);
    if (el) el.oninput = () => { validatePriceInputs(); };
  });
  validatePriceInputs();
}
function readPriceDraft(){
  const mn = parseFloat((($('#fpPriceMin') || {}).value || '').toString());
  const mx = parseFloat((($('#fpPriceMax') || {}).value || '').toString());
  const m = Number.isFinite(mn) ? Math.max(0, mn) : 0;
  const x = Number.isFinite(mx) ? Math.max(0, mx) : 0;
  return { min: m, max: x, ok: m <= x };
}
function validatePriceInputs(){
  const err = $('#fpPriceErr');
  if (!err || !dialogDraft) return true;
  const r = readPriceDraft();
  dialogDraft.priceMin = r.min; dialogDraft.priceMax = r.max;
  err.hidden = r.ok;
  return r.ok;
}
async function updatePanelCount(){
  const btn = $('#fpApply'); if (!btn || !dialogDraft) return;
  const seq = ++fpCountSeq;
  const pr = readPriceDraft();
  dialogDraft.priceMin = pr.min; dialogDraft.priceMax = pr.max;
  const p = shopFilterParams({ limit: 1, offset: 0, catPath: dialogDraft.catPath, dept: dialogDraft.dept, brand: dialogDraft.brand, priceMin: pr.min, priceMax: pr.max, q: shopState.q, sort: shopState.sort });
  try {
    const d = await apiShopV2(p.toString());
    if (seq !== fpCountSeq || !fpOpen) return;
    btn.firstElementChild && (btn.firstElementChild.textContent = t('f_show_results').replace('{n}', new Intl.NumberFormat(localeOf()).format(d.total)));
  } catch (e) { /* giữ label mặc định */ }
}
function openFilterPanel(){
  const panel = $('#filterPanel'); if (!panel || fpOpen) return;
  fpOpen = true;
  dialogDraft = draftFromState();
  brandQuery = ''; brandMore = false;
  renderPanel();
  panel.hidden = false;
  $('#fpBackdrop').hidden = false;
  document.body.classList.add('fp-open');
  fpLastFocus = document.activeElement;
  requestAnimationFrame(() => {
    panel.classList.add('open');
    const h = $('#fpTitle'); if (h) h.focus();
  });
  const ft = $('#filterToggle'); if (ft) ft.setAttribute('aria-expanded', 'true');
  updatePanelCount();
}
function closeFilterPanel(apply){
  const panel = $('#filterPanel'); if (!panel || !fpOpen) return;
  fpOpen = false; fpCountSeq++;
  panel.classList.remove('open');
  $('#fpBackdrop').hidden = true;
  document.body.classList.remove('fp-open');
  const done = () => { panel.hidden = true; };
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else setTimeout(done, 240);
  const ft = $('#filterToggle'); if (ft) ft.setAttribute('aria-expanded', 'false');
  if (apply) {
    if (!validatePriceInputs()) return;
    shopState.dept = dialogDraft.dept || '';
    shopState.catPath = (dialogDraft.catPath || []).slice();
    shopState.brand = dialogDraft.brand || '';
    shopState.priceMin = dialogDraft.priceMin || 0;
    shopState.priceMax = dialogDraft.priceMax || 0;
    commitFilter();
  }
  if (fpLastFocus && fpLastFocus.focus) fpLastFocus.focus();
}
function resetFilterDraft(){
  dialogDraft = { dept: '', catPath: [], brand: '', priceMin: 0, priceMax: 0 };
  brandQuery = ''; brandMore = false;
  renderPanel();
  updatePanelCount();
}
// hiệu ứng appliedState -> controls (chips + count) — CATALOG-R1: panel fp thay sidebar/dialog
function activeFilterCount(){
  let n = 0;
  if (shopState.brand) n++;
  if ((shopState.catPath || []).length > 1) n++;
  if (shopState.priceMin > 0 || shopState.priceMax > 0) n++;
  if (shopState.dept) n++;
  return n;
}
function renderChips(){
  const wrap = $('#chips'); if (!wrap) return;
  const chips = [];
  if (shopState.dept) chips.push({ kind: 'dept', label: deptLabel(shopState.dept) });
  if ((shopState.catPath || []).length > 1) chips.push({ kind: 'cat', label: (shopState.catPath || []).slice(1).join(' / ') });
  if (shopState.brand) chips.push({ kind: 'brand', label: brandLabel(shopState.brand) });
  if (shopState.priceMin > 0 || shopState.priceMax > 0) {
    const lo = shopState.priceMin > 0 ? fmtUSD(shopState.priceMin) : '…', hi = shopState.priceMax > 0 ? fmtUSD(shopState.priceMax) : '…';
    chips.push({ kind: 'price', label: 'US$ ' + lo + ' – ' + hi });
  }
  if (shopState.q) chips.push({ kind: 'q', label: '“' + shopState.q + '”' });
  wrap.innerHTML = chips.map(c =>
    '<button type="button" class="chip" data-chip="' + c.kind + '" aria-label="Xóa ' + esc(c.label) + '"><span>' + esc(c.label) + '</span><span class="chip-x" aria-hidden="true">×</span></button>'
  ).join('');
  wrap.querySelectorAll('[data-chip]').forEach(b => {
    b.onclick = () => {
      const k = b.getAttribute('data-chip');
      if (k === 'dept') { shopState.dept = ''; shopState.catPath = []; }
      else if (k === 'cat') shopState.catPath = (shopState.catPath || []).slice(0, 1);
      else if (k === 'brand') shopState.brand = '';
      else if (k === 'price') { shopState.priceMin = 0; shopState.priceMax = 0; }
      else shopState.q = '';
      commitFilter();
    };
  });
  const fc = $('#fcount');
  if (fc) { const n = activeFilterCount(); fc.hidden = !n; fc.textContent = n; }
  // nút Xóa tất cả chỉ hiện khi có điều kiện thật
  const ft = $('#clearAllWrap');
  if (ft) {
    ft.hidden = activeFilterCount() === 0 && !shopState.q;
    ft.onclick = () => { shopState.dept=''; shopState.catPath=[]; shopState.brand=''; shopState.priceMin=0; shopState.priceMax=0; shopState.q=''; commitFilter(); };
  }
}
// một hàm commit/reset duy nhất: render controls + query (reset offset0, giữ các điều kiện khác)
function commitFilter(){
  shopState.offset = 0;
  loadShopPage(true);
  renderChips();
}
// CATALOG-R1 §4A: sidebar radio + dialog cũ đã thay bằng filter panel trượt (#filterPanel).
// (renderCatOpts/renderPriceOpts/renderBrandOpts/syncSidebar/facetApply xóa 20/9 — dead DOM.)
async function renderShop(){
  document.title = '· ' + ({vi:'Cửa hàng', en:'Shop', zh:'商店', ko:'쇼핑'}[LANG] || 'Shop') + ' — Mandarin Jam';
  // CATALOG-R1 B.3: facets cùng feed V2 — nạp /api/shopv2/config (đồng bộ panel khi mở)
  v2Config().catch(() => {});
  // CATALOG-R1 §4A: nút Bộ lọc mở panel trượt (drawer desktop / bottom sheet mobile)
  const ft = $('#filterToggle'), panel = $('#filterPanel');
  if (ft && panel) { ft.onclick = () => openFilterPanel(); }
  const fpApply = $('#fpApply'), fpClose = $('#fpClose'), fpReset = $('#fpReset'), fpBackdrop = $('#fpBackdrop');
  if (fpApply) fpApply.onclick = () => closeFilterPanel(true);
  if (fpClose) fpClose.onclick = () => closeFilterPanel(false);
  if (fpReset) fpReset.onclick = () => resetFilterDraft();
  if (fpBackdrop) fpBackdrop.onclick = () => closeFilterPanel(false);
  // sort ngoài toolbar: reset offset0, giữ điều kiện khác
  const s = $('#fSort');
  if (s) s.onchange = () => { shopState.sort = s.value; commitFilter(); };
  // URL init: reset toàn bộ rồi ghi từ URL — direct reload/back/forward đọc state đầy đủ,
  // không giữ fragment cũ (STOREFRONT 4A: click dept/shop mới phải xóa q/brand/cat/price/offset cũ)
  Object.assign(shopState, { q: '', dept: '', catPath: [], brand: '', priceMin: 0, priceMax: 0, sort: 'default' });
  const u = new URLSearchParams(location.search);
  Object.assign(shopState, shopStateFromUrl(u));
  syncDeptNav();
  renderChips();
  // sort select sync từ URL
  if (s) s.value = shopState.sort || 'default';
  const focus = u.get('focus');
  if (focus === 'brand') {
    if (window.innerWidth < 1024) { openFilterPanel(); setTimeout(() => { const bs = $('#fpBrandSearch'); if (bs) bs.focus(); }, 260); }
    else { openFilterPanel(); setTimeout(() => { const bs = $('#fpBrandSearch'); if (bs) bs.focus(); }, 260); }
  }
  loadShopPage(true);
}
// Escape trong panel: bỏ draft, không Apply
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fpOpen) closeFilterPanel(false);
});
// resize qua breakpoint mobile->desktop: đóng sheet (panel tự đổi form bằng CSS, giữ draft nếu đang mở)
if (window.matchMedia) {
  const mq = window.matchMedia('(min-width: 1024px)');
  if (mq.addEventListener) mq.addEventListener('change', (e) => { if (e.matches && fpOpen) closeFilterPanel(false); });
}
function loadShopPage(reset){
  const grid = $('#shopGrid');
  const mySeq = ++shopReqSeq;
  if (reset) {
    shopState.offset = 0;
    shopState.shown = 0;
    shopState.total = 0;
    shopState.limit = 24;
    loadMorePending = false;
    lastLoadMoreError = false;
    grid.innerHTML = '<div class="grid-loading">' + esc(t('grid_loading')) + '</div>';
    const heading = shopState.dept ? deptLabel(shopState.dept) : (shopState.brand ? brandLabel(shopState.brand) : ((shopState.catPath || []).length > 1 ? (shopState.catPath || []).slice(1).join(' / ') : (shopState.q ? '“' + shopState.q + '”' : t('shopHeading'))));
    $('#shopHeading').textContent = heading;
    $('#pager').innerHTML = '';
  }
  (async () => {
    try {
      const d = await apiShopV2(shopFilterParams({ limit: shopState.limit, offset: shopState.offset }).toString());
      if (mySeq !== shopReqSeq) return;   // request cũ — bỏ
      shopState.total = d.total;
      shopState.shown = Math.min(d.items.length, d.total);
      const totalEl = $('#shopTotal');
      if (totalEl) totalEl.textContent = new Intl.NumberFormat(localeOf()).format(d.total) + ' ' + t('ps_unit');
      const rm = $('#resultMeta');
      if (rm) rm.textContent = d.total === 0 ? '' : tpl('showing_range', { a: new Intl.NumberFormat(localeOf()).format(shopState.shown), b: new Intl.NumberFormat(localeOf()).format(d.total) });
      if (reset) grid.innerHTML = '';
      if (reset && !d.items.length) {
        // STOREFRONT 4B: department chưa có hàng (vd Kids) — báo "being prepared", không empty spinner, không lấy hàng người lớn lấp chỗ
        if (shopState.dept) {
          grid.innerHTML = '<div class="shop-empty"><h3>' + esc(t('dept_preparing')) + '</h3><p></p><a class="btn btn-ghost" href="/shop" data-i18n="dept_browse_all">Browse all products</a></div>';
        } else {
          grid.innerHTML = '<div class="shop-empty"><h3>' + esc(t('empty_search_title')) + '</h3><p>' + esc(t('empty_search_body')) + '</p><button type="button" class="btn btn-ghost" id="emptyClearFilters">' + esc(t('f_clear')) + '</button></div>';
          const ec = document.getElementById('emptyClearFilters');
          if (ec) ec.onclick = () => { shopState.dept=''; shopState.catPath=[]; shopState.brand=''; shopState.priceMin=0; shopState.priceMax=0; shopState.q=''; commitFilter(); };
        }
      } else {
        d.items.forEach((raw, i) => { raw.matchedSku = d.matchedSku || ''; grid.appendChild(cardEl(lot1Card(raw), { hideOnLowRes: true, eager: i < 6 })); });
      }
      renderLoadMore();
      renderChips();
    } catch (e) {
      if (mySeq !== shopReqSeq) return;
      if (reset) grid.innerHTML = '<div class="grid-loading">' + esc(t('grid_error')) + '</div>';
    }
  })();
}
function localeOf(){ return ({ en: 'en-US', vi: 'vi-VN', zh: 'zh-CN', ko: 'ko-KR' }[LANG] || 'vi-VN'); }
// R2-03/R2-04B: hiển thị "1–N / tổng" bằng số item THỰC SỰ đã nhận (append 24→48 => 1–48),
// không lấy offset (sẽ ra "25–48"); load-more có guard: 1 request đang pending thì disable nút,
// chỉ commit offset/append khi đúng generation & thành công; lỗi giữ trang, retry đúng trang đó.
let loadMorePending = false;
let lastLoadMoreError = false;
function renderLoadMore(){
  const pg = $('#pager'); if (!pg) return;
  const shown = shopState.shown;
  const hasMore = shown < shopState.total;
  if (lastLoadMoreError) {
    pg.innerHTML = '<div class="loadmore-err"><span>' + esc(t('loadmore_err')) + '</span><button class="loadmore" data-go="retry">' + esc(t('loadmore_retry')) + '</button></div>';
    const rb = pg.querySelector('[data-go="retry"]');
    if (rb) rb.onclick = () => { lastLoadMoreError = false; renderLoadMore(); loadMore(); };
    return;
  }
  if (!hasMore) { pg.innerHTML = shown >= 1 && shopState.total > shopState.limit ? '<button disabled class="loadmore-end">' + t('all_shown') + ' ' + new Intl.NumberFormat(localeOf()).format(shopState.total) + ' ' + t('ps_unit') + '</button>' : ''; return; }
  pg.innerHTML = '<button class="loadmore" data-go="more"' + (loadMorePending ? ' disabled' : '') + '>' + esc(t('showMore')) + ' (' + new Intl.NumberFormat(localeOf()).format(shopState.total - shown) + ' ' + t('ps_unit') + ')</button>';
  const btn = pg.querySelector('[data-go="more"]');
  if (btn) btn.onclick = () => loadMore();
}
async function loadMore(){
  if (loadMorePending) return;                       // guard: đang pending thì bỏ
  const grid = $('#shopGrid');
  loadMorePending = true;
  const mySeq = shopReqSeq;                          // generation hiện tại
  const reqOffset = shopState.offset + shopState.limit;   // requestedOffset riêng — không tăng offset trước khi xong
  renderLoadMore();                                  // disable nút
  try {
    const d = await apiShopV2(shopFilterParams({ limit: shopState.limit, offset: reqOffset }).toString());
    if (mySeq !== shopReqSeq) return;                // đổi filter/sort lúc pending — response cũ không append
    shopState.offset = reqOffset;                    // chỉ commit khi đúng generation & thành công
    shopState.total = d.total;
    shopState.shown = Math.min(shopState.shown + d.items.length, d.total);
    const totalEl = $('#shopTotal');
    if (totalEl) totalEl.textContent = new Intl.NumberFormat(localeOf()).format(d.total) + ' ' + t('ps_unit');
    const rm = $('#resultMeta');
    if (rm) rm.textContent = d.total === 0 ? '' : tpl('showing_range', { a: new Intl.NumberFormat(localeOf()).format(shopState.shown), b: new Intl.NumberFormat(localeOf()).format(d.total) });
    d.items.forEach((raw, i) => { raw.matchedSku = d.matchedSku || ''; grid.appendChild(cardEl(lot1Card(raw), { hideOnLowRes: true, eager: false })); });
    lastLoadMoreError = false;
    loadMorePending = false;
    renderLoadMore();
    renderChips();
  } catch (e) {
    if (mySeq !== shopReqSeq) { return; }   // response cũ của đời trước: KHÔNG reset guard — request mới (đúng generation) giữ loadMorePending
    // giữ cards/offset đã nhận; hiện retry chính trang vừa lỗi, không tăng offset
    lastLoadMoreError = true;
    loadMorePending = false;
    renderLoadMore();
  }
}


/* ---------------- PDP ---------------- */
let pdpCurrent = null;
async function renderPDP(spuId){
  track('pdp', { spuId });
  // CATALOG-R1 R1-03: giữ mã SKU khi bấm vào — đọc ?sku= từ URL (cardEl đã gắn).
  // skuUrl là skuId (V2) hoặc sku (legacy). Pre-select size chip khớp + hiện badge "SKU khớp".
  const skuUrl = (new URLSearchParams(location.search).get('sku') || '').trim();
  const wrap = $('#pdpWrap');
  wrap.innerHTML = '<div class="grid-loading">' + esc(t('grid_loading')) + '</div>';
  let p;
  try { p = await fetchProduct(spuId); }
  catch (e) {
    // W1 S4: lỗi tải ≠ hết hàng; hiện message đúng ngôn ngữ + nút thử lại + về shop.
    // Không lộ mã lỗi/502 cho khách; chi tiết kỹ thuật chỉ trong attr data (diagnostics, không chứa secrets).
    // W2 C5: lỗi do hệ thống — nói rõ + đưa cách xử lý; không mascot, không raw 502, không gọi hết hàng
    wrap.innerHTML = '<div class="pdp-error">' +
      '<h1 class="pdp-error-title">' + esc(t('pdp_error_title')) + '</h1>' +
      '<p class="pdp-error-body">' + esc(t('pdp_error_body')) + '</p>' +
      '<div class="pdp-error-actions">' +
        '<button type="button" class="btn btn-primary" id="pdpRetry">' + esc(t('pdp_retry')) + '</button>' +
        '<a class="btn btn-ghost" href="/shop">' + esc(t('pdp_back')) + '</a>' +
      '</div>' +
      '<span class="pdp-diag" hidden data-err="' + esc(String(e && e.message || 'load')) + '">diag</span>' +
    '</div>';
    const rb = $('#pdpRetry'); if (rb) rb.onclick = () => renderPDP(spuId);
    return;
  }
  pdpCurrent = p;
  // R1-03: SKU khớp = ?sku= thật sự có trong SKU của sản phẩm (không bịa, không carry nhầm).
  const skuMatched = skuUrl ? (p.skus || []).find(s => String(s.skuId) === String(skuUrl)) || null : null;
  document.title = p.name + ' — ' + p.brand + ' — Mandarin Jam';
  setOG(p.name + ' — ' + p.brand, p.images[0], '/product/' + p.spuId); // W2.5
  const skus = p.skus;
  const firstAvail = p.availSkus[0];
  const minCNY = p.minCNY;
  wrap.innerHTML =
      '<div class="pdp-gallery">' +
        '<div class="pdp-main-img" id="pdpMain">' +
          (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="' + esc(p.name) + '">' : '<span class="grid-loading">' + esc(t('pdp_no_image')) + '</span>') +
        '</div>' +
      (p.images.length > 1 ? '<div class="pdp-thumbs">' +
        p.images.map((src, i) => '<img data-i="' + i + '" class="' + (i === 0 ? 'active' : '') + '" src="' + esc(src) + '" alt="' + esc(p.name) + '">').join('') +
      '</div>' : '') +
    '</div>' +
    '<div class="pdp-info">' +
      '<div class="pdp-crumb"><a href="/">' + esc(t('breadcrumbHome')) + '</a> / <a href="/shop">' + esc(t('nav_shop')) + '</a> / <span>' + esc(p.brand) + '</span></div>' +
      '<span class="pdp-brand">' + esc(p.brand) + '</span>' +
      '<h1 class="pdp-name">' + esc(p.name) + '</h1>' +
      // R-BRANDCODE: không hiện "SKU khớp: <skuId>" cho khách — mã nội bộ chỉ phục vụ xử lý.
      '' +
      '<div class="pdp-price-row">' +
        (p._v2 && p.canSell && p.minUsd > 0 ? '<span class="pdp-price">' + (p.availSkus.length > 1 ? esc(t('pdp_from')) + ' ' : '') + esc(fmtUSD(p.minUsd)) + '</span>'
          + ((p.refUsdMin > p.minUsd) ? '<span class="pdp-price-ref">' + esc(fmtUSD(p.refUsdMin)) + '</span><span class="pdp-price-pct">' + esc(discountPct(p.minUsd, p.refUsdMin)) + '</span>' : '')
          + '<span class="pdp-price-note">' + esc(t('pdp_price_usd')) + '</span>'
        : p.canSell && p.priceVerified ? '<span class="pdp-price">' + (p.availSkus.length > 1 ? esc(t('pdp_from')) + ' ' : '') + (p.priceViewRaw != null ? fmtPrice(p.priceViewRaw, LANG) : fmtVND(p.minVND)) + '</span>'
        : p.canSell && !p.priceVerified ? '<span class="pdp-price" style="color:var(--muted)">' + esc(t('pdp_price_confirm')) + '</span>'
        : (p.stockState === 'known-out') ? '<span class="pdp-price" style="color:var(--muted)">' + esc(t('outOfStock')) + '</span>'
        : (p.stockState === 'in-stock') ? '<span class="pdp-price">' + (p.priceViewRaw != null ? fmtPrice(p.priceViewRaw, LANG) : fmtVND(p.minVND)) + '</span>'
        : '<span class="pdp-status-unknown" style="color:var(--muted)">' + esc(t('pdp_status_unknown')) + '</span>') +
      '</div>' +
      '<div class="pdp-delivery" style="background:transparent;border-color:transparent;color:inherit;font-size:14px">' + esc(t('ship_est')) + ' <a href="/legal/van-chuyen" title="' + esc(t('ship_note')) + '">' + esc(t('ship_policy_label')) + '</a></div>' +
      (p.descVn ? '<div class="pdp-desc"><h4>' + ({vi:'Mô tả',en:'Description',zh:'描述',ko:'설명'}[LANG]||'Mô tả') + '</h4><p>' + esc(p.descVn) + '</p>' + '</div>' : '') +
      (skus.length ?
        '<div class="pdp-sizes"><h4>' + esc(t('pdp_choose_size')) + '</h4><div class="size-row" id="sizeRow">' +
        skus.map(s => {
          const out = s.stock <= 0;
          const stockUnknown = !(typeof s.stockRaw === 'number' && Number.isFinite(s.stockRaw) && s.stockRaw >= 0);
          const soldOut = !stockUnknown && s.stockRaw <= 0;
          const vnd = priceVND(s.priceCNY, p.brand);
          const priceOk = Number.isFinite(vnd) && vnd > 0;
          let sizePrice = '';
          if (stockUnknown) sizePrice = '';
          else if (soldOut) sizePrice = '<span class="s-price">' + esc(t('pdp_size_out')) + '</span>';
          else if (p._v2) {
            // CATALOG-R1 §4D: V2 = giá USD theo đúng SKU (salePriceUsd), reference gạch + % nếu có pair
            const su = Number(s.salePriceUsd) || 0;
            if (su > 0) {
              const ru = Number(s.referencePriceUsd) || 0;
              sizePrice = '<span class="s-price">' + esc(fmtUSD(su)) + ((ru > su) ? ' <s class="s-price-ref">' + esc(fmtUSD(ru)) + '</s> <span class="s-price-pct">' + esc(discountPct(su, ru)) + '</span>' : '') + '</span>';
            }
          }
          else if (LANG === 'vi' && priceOk) sizePrice = '<span class="s-price">' + fmtVND(vnd) + '</span>';
          // R2 B3: non-VI không tự quy đổi tiền và không mở khóa mua chỉ vì helperVND trả được số
          const lock = stockUnknown || soldOut; // R3-C1: quyền chọn size (để tư vấn) ≠ quyền mua; chỉ khóa khi stock unknown/hết. Không khóa non-VI/missing-price nếu size/stock rõ.
          const sizeDisp = (SIZE_LOCALE[s.size] || {})[LANG] || s.size;
          return '<button class="size-chip' + (soldOut ? ' out' : '') + '" data-sku="' + s.skuId + '" ' + ((soldOut || lock) ? 'disabled' : '') + '>' +
                      '<span>' + esc(sizeDisp) + '</span>' + sizePrice + '</button>';
        }).join('') +
        '</div></div>' :
        '<div class="pdp-sizes"><h4>Size</h4><p style="color:var(--muted);font-size:14px">' + esc(p.sizeKnown ? t('pdp_no_size') : t('pdp_status_unknown')) + '</p>' +
        '<input type="hidden" id="pdpNoSku" value="1"></div>') +
      '<div class="pdp-actions">' +
              '<button class="btn btn-primary" id="addToCart" ' + (p.canSell && p.priceVerified ? '' : 'disabled') + '>' + esc(t('addToCart')) + '</button>' +
              // W-UI C 19/9: Quýt = concierge (avatar + label), không phải sticker
              '<a class="btn btn-ghost" href="#ask-quyt" id="askQuyt">' + esc(t('pdp_support')) + '</a>' +
              '<a class="btn btn-ghost" href="/shop">' + esc(t('emptyCartCta')) + '</a>' +
            '</div>' +
      '<div class="pdp-src">' +
        // R-BRANDCODE: chỉ hiện Mã sản phẩm khi có mã thương hiệu thật (Brand/Style code).
        // KHÔNG hiện skuId/spuId nội bộ cho khách. Kèm màu (mã màu) nếu có.
        (p.brandCode ? '<span>' + esc(t('pdp_code')) + ': <code>' + esc(p.brandCode) + '</code></span>'
                     + (p.color ? '<span>' + esc(t('pdp_color')) + ': <code>' + esc(p.color) + '</code></span>' : '')
                     : '') +
        '<span>' + esc(t('pdp_category_label')) + ': ' + (() => {
          // W7-R2 B1: category hiển thị theo locale qua whitelist; không mapped ở locale không phải VI -> bỏ cấp đó
          window.__pdpCategoryUnmapped = window.__pdpCategoryUnmapped || [];
          const label = raw => {
            if (!raw) return null;
            const m = CATEGORY_LOCALE[raw];
            if (m) return m[LANG] || null;
            if (LANG === 'vi') { const v = catVi(raw); return v === raw ? null : v; }
            window.__pdpCategoryUnmapped.push({ raw: raw, lang: LANG });
            return null;
          };
          const levels = [label(p.categoryRaw), label(p.category2)].filter(Boolean);
          // UIUX-R1 P1b: category chưa map được locale -> trạng thái rõ "Chưa phân loại", không hiện gạch ngang như dữ liệu đã biết
          return esc(levels.length ? levels.join(' / ') : ({vi:'Chưa phân loại',en:'Uncategorized',zh:'未分类',ko:'미분류'}[LANG] || 'Uncategorized'));
        })() + '</span>' +
      '</div>' +
    '</div>';
  // thumbnails
  $$('#pdpWrap .pdp-thumbs img').forEach(t => t.onclick = () => {
    $('#pdpMain img')?.remove();
    const main = $('#pdpMain');
    const img = new Image(); img.src = t.src; img.alt = p.name; main.appendChild(img);
    $$('#pdpWrap .pdp-thumbs img').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
  });
  // size select
  // R1-03: pre-select size chip khớp ?sku= (nếu SKU còn chọn được); không có → SKU đầu còn hàng.
  let chosen = (skuMatched && skuMatched.stock > 0) ? skuMatched : (firstAvail || null);
  // W7-R3 B1: eligibility per selected SKU
  const skuEligibility = (sku) => {
    const r = { sku: sku, canAdd: false, canSell: false, reason: '', priceVND: null, priceConfirmed: false };
    if (!p.canSell || typeof p.canSell !== 'boolean' || !p.canSell) { r.reason = 'canSell-unconfirmed'; return r; }
    r.canSell = true;
    if (!sku) { r.reason = 'no-selection'; return r; }
    if (typeof sku.stockRaw !== 'number' || !Number.isFinite(sku.stockRaw) || sku.stockRaw < 0) { r.reason = 'stock-unknown'; return r; }
    if (sku.stockRaw <= 0) { r.reason = 'sold-out'; return r; }
    if (p._v2) {
      // CATALOG-R1 §4D: V2 = giá USD theo SKU (salePriceUsd) — mọi locale đều USD charge;
      // không qua CNY×4000×margin, không cần price_view theo LANG.
      const su = Number(sku.salePriceUsd) || 0;
      if (su <= 0) { r.reason = 'price-unknown'; return r; }
      r.priceUSD = su;
      r.priceConfirmed = true;
      r.canAdd = true;
      return r;
    }
    const v = priceVND(sku.priceCNY, p.brand);
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) { r.reason = 'price-unknown'; return r; }
    r.priceVND = v;
    r.priceConfirmed = true;
    // R3-C1: quyền mua theo selected SKU — xác minh currency theo LANG, không khóa toàn bộ chỉ bằng LANG.
    if (LANG === 'vi') { r.canAdd = true; return r; }
    // non-VI: chỉ mở nếu SKU (hoặc sản phẩm 1-SKU) có giá lựa chọn theo currency được chứng minh từ contract.
    const pv = p.priceViewRaw; // mốc giá theo LANG (server §7.1)
    const single = p.availSkus.length === 1;
    const pvOk = pv != null && (typeof pv === 'number' || (typeof pv === 'string' && pv !== '')) && Number.isFinite(Number(pv)) && Number(pv) > 0;
    if (single && pvOk) { r.canAdd = true; return r; }
    r.reason = 'price-currency-unconfirmed';
    return r;
  };
  const renderEligibility = (el) => {
    const priceEl = wrap.querySelector('.pdp-price');
    const atc = document.getElementById('addToCart');
    if (!priceEl || !atc) return;
    if (el.reason === 'sold-out') { priceEl.textContent = t('outOfStock'); atc.disabled = true; return; }
    if (el.reason === 'stock-unknown' || el.reason === 'no-selection' || el.reason === 'canSell-unconfirmed') { atc.disabled = true; return; }
    if (el.reason === 'price-unknown' || el.reason === 'price-currency-unconfirmed' || !el.priceConfirmed) { priceEl.textContent = t('pdp_price_confirm'); atc.disabled = true; return; }
    if (LANG === 'vi' && el.priceVND != null) { priceEl.textContent = fmtVND(el.priceVND); }
    else if (LANG !== 'vi' && p.priceViewRaw != null && Number.isFinite(Number(p.priceViewRaw)) && Number(p.priceViewRaw) > 0) { priceEl.textContent = fmtPrice(Number(p.priceViewRaw), LANG); }
    atc.disabled = !el.canAdd;
  };
  const pick = (chip) => {
    $$('#sizeRow .size-chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    chosen = skus.find(s => String(s.skuId) === String(chip.dataset.sku)) || chosen;
    renderEligibility(skuEligibility(chosen));
  };
  $$('#sizeRow .size-chip:not([disabled])').forEach(chip => chip.onclick = () => pick(chip));
  if (chosen) { const c = $$('#sizeRow .size-chip').find(x => x.dataset.sku === String(chosen.skuId)); if (c) { pick(c); renderEligibility(skuEligibility(chosen)); } }
  $('#addToCart').onclick = () => {
    const elig = skuEligibility(chosen);
    if (!elig.canAdd || !elig.priceConfirmed) { toast(t('pdp_price_confirm')); return; }
    cartAdd(p, chosen, 1);
    toast(t('toast_added') + ': ' + p.brand + ' · ' + chosen.size);
  };
  // W5.3: nút "Hỏi Quýt" — deep-link Zalo/WhatsApp prefill tên SP + link + size đã chọn (+ giá xác nhận nếu có)
  $('#askQuyt').onclick = (ev) => {
    ev.preventDefault();
    const elig = skuEligibility(chosen);
    let sizeTxt = '';
    if (chosen) {
      const stockTxt = (typeof chosen.stockRaw === 'number' && Number.isFinite(chosen.stockRaw) && chosen.stockRaw >= 0) ? ('(còn ' + chosen.stockRaw + ')') : '';
      sizeTxt = '\nSize: ' + chosen.size + (stockTxt ? ' ' + stockTxt : '');
    }
    // Chỉ kèm giá khi selected price đã xác nhận hợp lệ; bỏ giá unknown/0/âm, không nói "còn0" khi stock unknown.
    const confirmed = elig.priceConfirmed && elig.priceVND != null && Number.isFinite(elig.priceVND) && elig.priceVND > 0;
    const priceTxt = confirmed ? ('\nGiá (VND): ' + fmtVND(elig.priceVND)) : '';
    const msg = encodeURIComponent('Mandarin Jam\nSản phẩm: ' + (p.name || '') + sizeTxt + priceTxt + '\nLink: ' + location.href);
    const z = 'https://zalo.me/' + (window.MJ_ZALO || '');
    location.href = z ? (z + '?text=' + msg) : msg;
  };
  // W5.3: áp nhãn đa ngôn ngữ cho 2 nút (Thêm giỏ + Hỏi Quýt)
    const aq = $('#askQuyt'); if (aq) aq.textContent = t('pdp_support');
    const ac = $('#addToCart'); if (ac) ac.textContent = t('addToCart');
}

/* ---------------- CART ---------------- */
function renderCart(){
  document.title = 'Giỏ hàng — Mandarin Jam';
  const body = $('#cartBody');
  const st = cartRead();
  if (!st.lines.length) {
    // W2 C1: empty.cartTitle + empty.cartBody (PMO_COPY_W2.json); giữ CTA về shop
    body.innerHTML = '<div class="empty-state"><h3>' + esc(t('emptyCart')) + '</h3><p>' + esc(t('empty_cart_body')) + '</p><a class="btn btn-primary" href="/shop">' + esc(t('emptyCartCta')) + '</a></div>';
    return;
  }
  let html = st.lines.map(l => {
    const pf = linePriceFmt(l);
    const refTxt = (l.currency === 'USD' && l.priceRefUSD && l.priceRefUSD > (l.priceUSD || 0)) ? ' <s style="color:var(--muted);font-size:12px">' + esc(fmtUSD(l.priceRefUSD * l.qty)) + '</s>' : '';
    return '<div class="cart-line">' +
      (l.img ? '<img src="' + esc(l.img) + '" alt="">' : '') +
      '<div class="cl-info"><span class="cl-brand">' + esc(l.brand) + '</span><span class="cl-title">' + esc(l.name) + '</span><span class="cl-size">Size: ' + esc(l.size) + '</span></div>' +
      '<div class="cl-price">' + pf.text + refTxt + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">' +
        '<div class="qty"><button data-act="dec" data-spu="' + l.spuId + '" data-sku="' + l.skuId + '">−</button><span>' + l.qty + '</span><button data-act="inc" data-spu="' + l.spuId + '" data-sku="' + l.skuId + '">+</button></div>' +
        '<button class="remove-link" data-act="rm" data-spu="' + l.spuId + '" data-sku="' + l.skuId + '">Xoá</button>' +
      '</div>' +
    '</div>';
  }).join('');
  const totals = cartTotals();
  // CATALOG-R1 §6: legacy line giữ VND snapshot; USD line tổng USD (đơn tiền thật khi payment bật).
  // Mixed cart: hiện 2 dòng riêng — không gộp 2 currency thành 1 số.
  let totalRows = '';
  if (totals.hasUsd && totals.hasVnd) {
    totalRows = '<div class="row"><span>USD (món kho mới):</span><span class="total">' + esc(fmtUSD(totals.usd)) + '</span></div>' +
      '<div class="row"><span>VND (món cũ — tham khảo):</span><span class="total">' + fmtVND(totals.vnd) + '</span></div>';
  } else if (totals.hasUsd) {
    totalRows = '<div class="row"><span>Tạm tính:</span><span class="total">' + esc(fmtUSD(totals.usd)) + '</span></div>';
  } else {
    totalRows = '<div class="row"><span>Tạm tính:</span><span class="total">' + fmtVND(totals.vnd) + '</span></div>';
  }
  html += '<div class="cart-totals">' +
    '<div class="row" style="color:var(--muted);font-size:13px"><span>' + esc(t('ship_est')) + '</span></div>' +
    totalRows +
    '<a class="btn btn-primary" href="/checkout">Tiếp tục thanh toán</a>' +
    '<a class="btn btn-ghost" href="/shop">Mua thêm</a>' +
  '</div>';
  body.innerHTML = html;
  $$('[data-act]', body).forEach(btn => btn.onclick = () => {
    const a = btn.dataset.act, spu = Number(btn.dataset.spu), sku = Number(btn.dataset.sku);
    const line = cartRead().lines.find(x => x.spuId === spu && x.skuId === sku);
    if (!line) return;
    if (a === 'inc') cartSetQty(spu, sku, line.qty + 1);
    if (a === 'dec') cartSetQty(spu, sku, line.qty - 1);
    if (a === 'rm') cartRemove(spu, sku);
    renderCart();
  });
}

/* ---------------- CHECKOUT (DEMO — không thanh toán thật) ---------------- */
// W5.4: checkout 3 bước (địa chỉ -> phương thức -> xác nhận), guest, tạo đơn server-side qua /api/order + theo dõi trạng thái.
// COD khả dụng ngay (không cần key). Paydollar/AsiaPay sandbox cần ANH TEE cấp key (kẽ hở W3.3) -> hiển thị nhưng chọn sẽ báo CẦN ANH TEE.
function renderCheckout(){
  document.title = 'Thanh toán — Mandarin Jam';
  const body = $('#checkoutBody');
  const st = cartRead();
  if (!st.lines.length) {
    body.innerHTML = '<div class="empty-state"><p>' + t('emptyCart') + '</p><a class="btn btn-primary" href="/shop">' + t('emptyCartCta') + '</a></div>';
    document.title = t('checkout') + ' — Mandarin Jam';
    return;
  }
  let flow = { step: 1, method: 'cod', order: null, err: '' };
  const tt = cartTotals();
  // CATALOG-R1 §4D/§6: dòng V2 = USD chính; dòng legacy = VND snapshot (đơn cũ giữ tiền tệ).
  const rows = st.lines.map(l => {
      const pf = linePriceFmt(l);
      const refTxt = (l.currency === 'USD' && l.priceRefUSD && l.priceRefUSD > (l.priceUSD || 0)) ? ' <s style="color:var(--muted);font-size:12px">' + esc(fmtUSD(l.priceRefUSD * l.qty)) + '</s>' : '';
      return '<div class="co-line"><span>' + esc(l.brand) + ' — ' + esc(l.name) + ' <span style="color:var(--muted)">(size ' + esc(l.size) + ' × ' + l.qty + ')</span></span><span>' + pf.text + refTxt + '</span></div>';
    }).join('');
  // total theo currency: USD (kho mới) + VND (legacy) — không gộp 2 tiền tệ.
  // discVnd = discount VND từ promo (legacy, MJWEB5) — chỉ áp dòng VND, KHÔNG trừ dòng USD
  // (USD charge cần server quote riêng — WEB-PAY-01; không tự quy đổi promo sang USD).
  const totalLineHtml = (discVnd) => {
    const dV = Math.max(0, (discVnd || 0));
    if (tt.hasUsd && tt.hasVnd) return '<div class="co-line" style="font-weight:700;font-size:17px"><span>' + t('total') + ' (USD)</span><span>' + esc(fmtUSD(tt.usd)) + '</span></div>'
      + '<div class="co-line" style="font-size:14px;color:var(--muted)"><span>' + t('total') + ' (VND — món cũ)' + (dV > 0 ? ' − ' + fmtVND(dV) : '') + '</span><span>' + fmtVND(tt.vnd - dV) + '</span></div>';
    if (tt.hasUsd) return '<div class="co-line" style="font-weight:700;font-size:17px"><span>' + t('total') + '</span><span>' + esc(fmtUSD(tt.usd)) + '</span></div>';
    return '<div class="co-line" style="font-weight:700;font-size:17px"><span>' + t('total') + '</span><span>' + fmtVND(tt.vnd - dV) + '</span></div>';
  };
  const summaryRow = rows + totalLineHtml(0);
  const stepsHtml =
    '<div class="co-steps">' +
      ['Bước 1 · Địa chỉ', 'Bước 2 · Thanh toán', 'Bước 3 · Xác nhận'].map((s, i) =>
        '<div class="co-step' + (i + 1 <= flow.step ? ' on' : '') + '">' + (i + 1) + '</div>').join('') +
    '</div>';
  function render(){
    let html = stepsHtml;
    if (flow.step === 1) {
      html += '<form id="step1" class="co-form">' +
        '<div class="full"><label>' + t('co_name') + '</label><input id="cName" required placeholder="Nguyễn Văn A"></div>' +
        '<div><label>' + t('co_phone') + '</label><input id="cPhone" required inputmode="tel" placeholder="09xx xxx xxx"></div>' +
        '<div><label>Email</label><input id="cEmail" type="email" placeholder="ban@email.com"></div>' +
        '<div class="full"><label>' + t('co_addr') + '</label><textarea id="cAddr" rows="3" required placeholder="Số nhà, đường, quận, thành phố"></textarea></div>' +
        '<div class="full"><label>' + t('co_note') + '</label><input id="cNote" placeholder="…"></div>' +
        '<div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap"><button class="btn btn-primary" type="submit">' + t('co_next') + '</button><a class="btn btn-ghost" href="/cart">' + t('editCart') + '</a></div>' +
      '</form>';
    } else if (flow.step === 2) {
      // CATALOG-FILTER-USD §6 (20/9): phương thức chỉ hiện khi server capability xác nhận (WEB-PAY-01).
      // COD giữ cho đơn legacy (280 SPU VND). Hàng kho mới (USD) KHÔNG cho COD — báo rõ, không silent fallback.
      const codOk = !tt.hasUsd;
      const cardOk = tt.hasUsd; // WEB-PAY-01/03: giỏ USD → mở PayDollar (adapter /api/order/usd + /api/payment/start)
      html += '<div class="co-methods">' +
        '<label class="co-method"' + (codOk ? '' : ' style="opacity:.55"') + '><input type="radio" name="pay" value="cod"' + (codOk ? ' checked' : ' disabled') + '><span><strong>COD — </strong>' + t('co_cod') + (codOk ? '' : ' (chỉ đơn tiền cũ VND)') + '</span></label>' +
        '<label class="co-method"' + (cardOk ? '' : ' style="opacity:.55"') + '><input type="radio" name="pay" value="paydollar"' + (cardOk ? ' checked' : ' disabled') + '><span><strong>Thẻ quốc tế (USD) — </strong>' + (cardOk ? 'PayDollar / AsiaPay' : esc(t('co_card_soon'))) + '</span></label>' +
      '</div>' +
      (tt.hasUsd ? '<p style="font-size:13px;color:var(--muted);margin:8px 0 0">' + esc(t('co_usd_note')) + '</p>' : '') +
      '<div class="co-promo">' +
        '<label>' + t('co_promo') + ' <span style="font-weight:700;color:var(--mandarin)">MJWEB5</span> (−5%)</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<input id="promoCode" placeholder="MJWEB5" style="flex:1;min-width:140px;padding:11px 12px;border:1px solid var(--hair);border-radius:10px">' +
          '<button class="btn btn-ghost" id="applyPromo" type="button">' + t('co_apply') + '</button>' +
        '</div>' +
        '<p id="promoMsg" style="font-size:13px;margin:6px 0 0;color:var(--muted)"></p>' +
      '</div>' +
      '<div class="co-line" style="font-weight:700;font-size:17px;margin-top:6px"><span>' + t('subtotal') + '</span><span>' + (tt.hasUsd ? esc(fmtUSD(tt.usd)) + ' ' + (tt.hasVnd ? '+ ' : '') + fmtVND(tt.vnd) : fmtVND(tt.vnd)) + '</span></div>' +
      (flow.discount ? '<div class="co-line" style="color:#111111"><span>' + t('co_disc') + ' (MJWEB5 — đơn VND)</span><span>−' + fmtVND(flow.discount) + '</span></div>' : '') +
      totalLineHtml(flow.discount) +
      '<div style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap">' +
        '<button class="btn btn-primary" id="goConfirm">' + t('co_review') + '</button>' +
        '<button class="btn btn-ghost" id="back1">← ' + t('co_back') + '</button>' +
      '</div>' +
      '<div style="margin-top:10px;font-size:13px;color:var(--muted)">' + esc(t('ship_est')) + ' <a href="/legal/van-chuyen">' + esc(t('ship_policy_label')) + '</a></div>';
    } else if (flow.step === 3) {
      const pm = flow.method === 'cod' ? ('COD — ' + t('co_cod')) : 'Paydollar / AsiaPay';
      html += summaryRow +
        (flow.discount ? '<div class="co-line" style="color:#111111"><span>' + t('co_disc') + ' (MJWEB5 — đơn VND)</span><span>−' + fmtVND(flow.discount) + '</span></div>' : '') +
        totalLineHtml(flow.discount) +
        '<div class="co-line"><span>' + t('co_pay') + '</span><span>' + esc(pm) + '</span></div>' +
        (flow.err ? '<p style="color:#111111">' + esc(flow.err) + '</p>' : '') +
        '<div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">' +
          '<button class="btn btn-primary" id="placeOrder"' + (flow.err ? ' disabled' : '') + '>' + t('applyOrder') + '</button>' +
          '<button class="btn btn-ghost" id="back2">← ' + t('co_back') + '</button>' +
        '</div>';
    }
    body.innerHTML = html;
    if (flow.step === 1) $('#step1').onsubmit = (e) => { e.preventDefault();
      if (!$('#cName').value.trim()) return toast(t('co_req_name'));
      if (!/^\d{7,13}$/.test($('#cPhone').value.replace(/[\s\-().]/g, ''))) return toast(t('co_req_phone'));
      flow.name = $('#cName').value.trim(); flow.phone = $('#cPhone').value.trim();
      flow.email = ($('#cEmail').value || '').trim(); flow.addr = $('#cAddr').value.trim(); flow.note = $('#cNote').value || '';
      flow.step = 2; render();
    };
    if (flow.step === 2) {
      const radios = $$('input[name="pay"]');
      radios.forEach(r => r.onchange = () => { flow.method = r.value; });
      $('#back1').onclick = () => { flow.step = 1; render(); };
      $('#applyPromo').onclick = async () => {
        const c = ($('#promoCode').value || '').trim().toUpperCase();
        const msg = $('#promoMsg');
        if (!c) { msg.textContent = t('co_promo_empty'); return; }
        if (!tt.hasVnd) { msg.style.color = '#111111'; msg.textContent = 'Khuyến mãi MJWEB5 chỉ áp dụng cho đơn tiền cũ (VND).'; return; }
        try {
          const r = await fetch('/api/promo/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c, total_vi: tt.vnd }) });
          const d = await r.json();
          if (!r.ok) { msg.style.color = '#111111'; msg.textContent = d.detail || t('co_promo_bad'); return; }
          flow.discount = d.discount_vi; flow.promoCode = c;
          msg.style.color = 'var(--mandarin)'; msg.textContent = t('co_promo_ok') + ' −' + fmtVND(d.discount_vi);
          render();
        } catch (e) { msg.style.color = '#111111'; msg.textContent = t('co_promo_bad'); }
      };
      $('#goConfirm').onclick = () => {
        const sel = ($$('input[name="pay"]').find(r => r.checked) || {}).value || 'cod';
        flow.method = sel;
        // CATALOG-FILTER-USD §6: cart có USD (kho mới) KHÔNG cho COD — báo rõ, không silent fallback.
        if (tt.hasUsd && sel === 'cod') { flow.err = t('co_usd_no_cod'); flow.step = 3; render(); return; }
        if (tt.hasUsd && sel === 'paydollar') { flow.err = ''; flow.step = 3; render(); return; }
        if (sel !== 'cod') { flow.err = t('co_card_soon'); flow.step = 3; render(); return; }
        flow.err = ''; flow.step = 3; render();
      };
    }
    if (flow.step === 3) {
      $('#back2').onclick = () => { flow.step = 2; render(); };
      $('#placeOrder').onclick = async () => {
        // Guard bấm đồng thời: một ý định thanh toán đang chạy -> không khởi động lần hai.
        if (flow._paySubmitting) return;
        $('#placeOrder').disabled = true;
        // CATALOG-FILTER-USD §6: giỏ USD → đơn USD + PayDollar qua adapter; không tạo COD VND.
        if (tt.hasUsd && flow.method === 'paydollar') {
          try {
            flow._paySubmitting = true;
            const ud = await fetch('/api/order/usd', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ lang: LANG, lines: st.lines.map(l => ({ spuId: l.spuId, skuId: l.skuId, qty: l.qty })),
                shipLane: 'VN_STANDARD', utm: MJ_UTM || undefined, idemKey: checkoutIdemKey(st.lines),
                buyer: { name: flow.name, phone: flow.phone, email: flow.email, address: flow.addr }, payment: { method: 'paydollar' } }) });
            const udj = await ud.json();
            if (!ud.ok || !udj.ok || !udj.order || !udj.order.id) throw new Error((udj && udj.detail) || 'usd_order_failed');
            const oid = udj.order.id;
            track('place', { orderId: oid }); track('order', { orderId: oid });
            // start payment (/issue → FNOS continue URL; web không build form PayDollar)
            const ps = await fetch('/api/payment/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: oid }) });
            const psj = await ps.json();
            if (!ps.ok || !psj.ok || !psj.startUrl) {
              flow.err = (psj && psj.detail) || (psj && psj.error) || 'Cổng thanh toán chưa mở — thử lại sau.'; flow.step = 3; $('#placeOrder').disabled = false; flow._paySubmitting = false; render(); return;
            }
            // KHÔNG build form PayDollar, KHÔNG gửi thẳng PayDollar (contract §2 L91-93): server trả
            // startUrl (nút /start/<token> của FNOS) — ta chuyển khách SANG FNOS, cùng tab top-level,
            // FNOS render form auto-submit tại đó. Trang rời đi; không còn cơ hội bấm lại.
            // Nếu server trả reused=true (đã có attempt không-terminal — bấm lại/refresh sau mất kết
            // nối, chưa rõ giao dịch trước tới đâu), ta cũng KHÔNG gửi lại form: chuyển sang trang
            // trạng thái đơn CÓ KIỂM TRA CHỦ ĐƠN (server /api/order/:id owner-scoped, kẻ khác 404).
            if (psj.reused === true) {
              flow._paySubmitting = false;
              window.location.href = '/order/' + encodeURIComponent(oid);
              return;
            }
            window.location.href = psj.startUrl;
            return;
          } catch (e) { flow.err = 'Lỗi tạo thanh toán: ' + (e.message || e); flow.step = 3; $('#placeOrder').disabled = false; flow._paySubmitting = false; render(); }
          return;
        }
        if (tt.hasUsd) { flow.err = t('co_usd_no_cod'); $('#placeOrder').disabled = false; render(); return; }
        if (flow.method === 'cod') {
          const items = st.lines.map(l => ({ spuId: l.spuId, skuId: l.skuId, qty: l.qty }));
          try {
            const resp = await fetch('/api/order', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ lang: LANG, items, promo: flow.promoCode ? { code: flow.promoCode } : undefined,
                utm: MJ_UTM || undefined,
                buyer: { name: flow.name, phone: flow.phone, email: flow.email, address: flow.addr }, shipping: { method: 'standard', fee_vi: 0 }, payment: { method: 'cod' } }) });
            const d = await resp.json();
            if (!resp.ok || !d.ok) throw new Error((d && d.detail) || 'order_failed');
            flow.order = d.order;
            track('place', { orderId: d.order.id });
            track('order', { orderId: d.order.id });
            flow.done = true;
            cartWrite({ lines: [] }); renderCartCount();
            flow.step = 4; render();
          } catch (e) { flow.err = 'Lỗi tạo đơn: ' + (e.message || e); $('#placeOrder').disabled = false; render(); }
        } else {
          flow.err = 'Cổng trực tuyến chưa mở — chọn COD.'; $('#placeOrder').disabled = false; render();
        }
      };
    }
    if (flow.step === 4 && flow.order) {
      body.innerHTML = '<div class="co-success">' +
        '<h3>' + t('co_done') + '</h3>' +
        '<p style="margin:0;max-width:48ch">Mã đơn <strong>' + esc(flow.order.id) + '</strong> · ' +
          fmtVND(flow.order.total_vi || 0) + ' · ' + (flow.order.payment && flow.order.payment.method === 'cod' ? ('COD — ' + t('co_cod')) : '') + '. ' +
          t('co_done_sub') + '</p>' +
        (flow.order.promo ? '<p style="margin:0;font-size:13px;color:#111111">' + t('co_disc') + ': −' + fmtVND(flow.order.discount || 0) + ' (MJWEB5)</p>' : '') +
        '<div class="co-group">' +
          '<img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent('https://zalo.me/g/' + (window.MJ_GROUP || '')) + '" alt="" width="120" height="120">' +
          '<p style="margin:8px 0 0;font-size:14px">' + t('co_group') + '</p>' +
          '<a class="btn btn-ghost" href="https://zalo.me/g/' + esc(window.MJ_GROUP || '') + '" target="_blank" rel="noopener">' + t('co_group_btn') + '</a>' +
        '</div>' +
        '<a class="btn btn-primary" href="/order/' + esc(flow.order.id) + '">' + t('co_track') + '</a> ' +
        '<a class="btn btn-ghost" href="/shop">' + t('emptyCartCta') + '</a>' +
      '</div>';
      try { localStorage.setItem('mj.last.order', JSON.stringify({ id: flow.order.id, totalVND: flow.order.total_vi })); } catch {}
      window.scrollTo(0, 0);
    }
  }
  render();
}

/* W5.4: theo dõi trạng thái đơn (đã nhận / đang xử lý / giao) */
function renderOrderStatus(id){
  document.title = 'Đơn hàng — Mandarin Jam';
  const body = $('#checkoutBody');
  body.innerHTML = '<div class="grid-loading">' + t('grid_loading') + '</div>';
  showPage('checkout');
  fetch('/api/order/' + encodeURIComponent(id)).then(r => r.json()).then(d => {
    if (!d || !d.id || d.error) { body.innerHTML = '<div class="co-success"><h3>' + t('co_notfound') + '</h3><a class="btn btn-primary" href="/shop">' + t('emptyCartCta') + '</a></div>'; return; }
    const o = d;
    const stage = o.status === 'delivered' ? 3 : (o.status === 'processing' ? 2 : 1);
    const label = ['Đã nhận đơn', 'Đang xử lý', 'Đã giao'][stage - 1];
    body.innerHTML = '<div class="co-status">' +
      '<h3>' + t('co_order') + ' <code>' + esc(o.id) + '</code></h3>' +
      '<div class="co-steps">' + ['Đã nhận đơn', 'Đang xử lý', 'Đã giao'].map((s, i) => '<div class="co-step' + (i + 1 <= stage ? ' on' : '') + '" style="width:auto;padding:10px 12px">' + (i + 1) + '</div>').join('') + '</div>' +
      '<p style="font-weight:700">' + esc(label) + '</p>' +
      '<p style="font-size:13px;color:var(--muted)">Tổng: ' + fmtVND(o.total_vi || 0) + ' · ' + esc(o.payment && o.payment.method === 'cod' ? ('COD — ' + t('co_cod')) : '') + '</p>' +
      '<div class="co-line" style="font-weight:700"><span>Nguyên trạng (server)</span><span>' + esc(o.status) + '</span></div>' +
      '<a class="btn btn-primary" href="/shop" style="margin-top:18px">' + t('emptyCartCta') + '</a>' +
    '</div>';
  }).catch(() => { body.innerHTML = '<div class="co-success"><h3>' + t('co_notfound') + '</h3><a class="btn btn-primary" href="/shop">' + t('emptyCartCta') + '</a></div>'; });
}

/* ---------------- LEGAL ---------------- */
// CONTENT_C/D: /legal là HUB danh sách chính sách (không default Về chúng tôi);
// trang con dùng MJ_POLICIES (candidate từ policies.js) + alias cũ giữ nguyên.
const LEGAL_ORDER = ['van-chuyen','doi-tra','thanh-toan','khieu-nai',
  'dieu-khoan-mua-ban','quyen-rieng-tu','cookie','nguon-goc-tinh-trang','ve-chung-toi','cau-hoi-thuong-gap'];
const LEGAL_ALIAS = { 'bao-mat': 'quyen-rieng-tu', 've-chung-toi': 've-chung-toi' };
// nhãn locale cho mục chính sách
const LEGAL_TITLE = {
  'van-chuyen': { vi:'Vận chuyển & giao hàng', en:'Shipping & delivery', zh:'配送与发货', ko:'배송 및 발송' },
  'doi-tra': { vi:'Hủy, đổi trả & hoàn tiền', en:'Cancellation, returns & refunds', zh:'取消、退换与退款', ko:'취소, 반품 및 환불' },
  'thanh-toan': { vi:'Thanh toán', en:'Payments', zh:'支付', ko:'결제' },
  'khieu-nai': { vi:'Liên hệ & hỗ trợ', en:'Contact & support', zh:'联系与支持', ko:'문의 및 지원' },
  'dieu-khoan-mua-ban': { vi:'Điều khoản mua bán', en:'Terms of sale', zh:'销售条款', ko:'판매 약관' },
  'quyen-rieng-tu': { vi:'Quyền riêng tư', en:'Privacy', zh:'隐私', ko:'개인정보' },
  'cookie': { vi:'Cookie & lưu trữ', en:'Cookies & storage', zh:'Cookie 与存储', ko:'쿠키 및 저장' },
  'nguon-goc-tinh-trang': { vi:'Nguồn gốc & tình trạng sản phẩm', en:'Product origin & status', zh:'产品来源与状态', ko:'상품 출처 및 상태' },
  've-chung-toi': { vi:'Về chúng tôi', en:'About us', zh:'关于我们', ko:'회사 소개' },
  'cau-hoi-thuong-gap': { vi:'Câu hỏi thường gặp', en:'FAQs', zh:'常见问题', ko:'자주 묻는 질문' },
};
function legalTitle(slug){
  const m = LEGAL_TITLE[slug]; return m ? (m[LANG] || m.vi) : slug;
}
function renderLegal(slug){
  const raw = slug || '';
  const key = (raw && MJ_POLICIES[raw]) ? raw : (LEGAL_ALIAS[raw] || '');
  const pg = document.createElement('div');
  // Nếu chưa xác định key -> HUB index
  if (!key){
    pg.className = 'narrow legal-hub';
    pg.innerHTML =
      '<h2>' + (LANG==='vi'?'Chính sách & hỗ trợ':LANG==='en'?'Policies & support':LANG==='zh'?'政策与支持':'정책 및 지원') + '</h2>' +
      '<p style="color:var(--ink-soft);margin:8px 0 24px">' + ({vi:'Chọn mục để xem chi tiết:',en:'Choose a topic:',zh:'选择主题查看详情：',ko:'주제를 선택하세요:'}[LANG]||'') + '</p>' +
      '<div class="legal-hub-list">' + LEGAL_ORDER.map(s =>
        '<a class="legal-hub-item" href="/legal/' + s + '"><span class="lh-t">' + esc(legalTitle(s)) + '</span><span class="lh-a">→</span></a>'
      ).join('') + '</div>';
    document.title = ({vi:'Chính sách & hỗ trợ',en:'Policies & support',zh:'政策与支持',ko:'정책 및 지원'}[LANG]||'Policies') + ' — Mandarin Jam';
    showPage('legal');
    const o = $('#page-legal'); if (o) o.innerHTML=''; o && o.appendChild(pg);
    return;
  }
  const page = MJ_POLICIES[key];
  document.title = legalTitle(key) + ' — Mandarin Jam';
  pg.className = 'narrow';
  const bodyHtml = (page && typeof page === 'object' && !page.body) ? (page[LANG] || page.en || '') : (page.body && typeof page.body === 'object' ? (page.body[LANG] || page.body.en || '') : (page && page.body || ''));
  pg.innerHTML =
    '<div class="legal-nav"><a href="/legal">← ' + ({vi:'Tất cả chính sách',en:'All policies',zh:'全部政策',ko:'모든 정책'}[LANG]||'All') + '</a></div>' +
    '<div class="legal-body"><h2>' + esc(legalTitle(key)) + '</h2>' + bodyHtml + '</div>';
  showPage('legal');
  const o = $('#page-legal'); if (o) o.innerHTML = '';  o && o.appendChild(pg);
}

/* ---------------- ORDER REQUEST (W5.1: "Quýt chọn hộ") ---------------- */
function renderOrderRequest(){
  document.title = 'Quýt chọn hộ bạn — Mandarin Jam';
  const pg = document.createElement('div');
  pg.className = 'narrow';
  pg.innerHTML =
    '<h2>' + ({vi:'Quýt chọn hộ bạn',en:'Let Quyt pick for you',zh:'让桔子代选',ko:'궽이 대신 골라주기'}[LANG]||'Quýt chọn hộ bạn') + '</h2>' +
    '<p style="color:var(--ink-soft);margin:8px 0 20px">' + ({vi:'Bạn đang tìm món gì? Gửi cho Quýt nhu cầu, chúng mình chọn giúp bạn rồi báo giá nhanh.',en:'Looking for something? Tell Quyt what you need and we\'ll pick it for you with a quick quote.',zh:'想找什么？把需求发给桔子，我们帮你选好并快速报价。',ko:'무엇을 찾으시나요? 궽에게 요청을 보내시면 골라드리고 빠르게 견적드립니다.'}[LANG]||'') + '</p>' +
    '<div class="order-req-form" style="display:flex;flex-direction:column;gap:12px;max-width:520px">' +
      '<input id="reqName" placeholder="' + ({vi:'Tên của bạn',en:'Your name',zh:'您的称呼',ko:'이름'}[LANG]||'') + '" style="padding:12px;border:1.5px solid var(--hair);border-radius:10px;font:inherit">' +
      '<textarea id="reqText" rows="4" placeholder="' + ({vi:'Món bạn muốn (ví dụ: túi da đen tầm 8 triệu, size M…)',en:'What you want (e.g. black leather bag ~$250, size M…)',zh:'您想要的商品（例如：黑色皮包约2000元，M码…）',ko:'원하시는 상품 (예: 검정 가죽백 30만원, M사이즈…)'}[LANG]||'') + '" style="padding:12px;border:1.5px solid var(--hair);border-radius:10px;font:inherit;resize:vertical"></textarea>' +
      '<button class="btn btn-primary" id="reqSend">' + ({vi:'Gửi cho Quýt qua Zalo',en:'Send to Quyt via Zalo',zh:'通过 Zalo 发给桔子',ko:'Zalo로 궽에게 보내기'}[LANG]||'Gửi') + '</button>' +
      '<p style="font-size:13px;color:var(--muted)">' + ({vi:'Bấm gửi sẽ mở Zalo/WhatsApp với nội dung đã điền sẵn — không lưu lại trên web.',en:'Sending opens Zalo/WhatsApp pre-filled — nothing is stored on the web.',zh:'发送将打开已填好的 Zalo/WhatsApp — 网页不留存任何信息。',ko:'보내기를 누르면 미리 채워진 Zalo/WhatsApp이 열립니다 — 웹에는 저장되지 않습니다.'}[LANG]||'') + '</p>' +
    '</div>';
  const o = $('#page-order'); if (o) o.innerHTML = ''; o && o.appendChild(pg);
  $('#reqSend').onclick = () => {
    const n = ($('#reqName') || {}).value || '';
    const t = ($('#reqText') || {}).value || '';
    const msg = encodeURIComponent('Mandarin Jam — Quýt chọn hộ\nTên: ' + n + '\nNhu cầu: ' + t + '\nLink: ' + location.href);
    const z = 'https://zalo.me/' + (window.MJ_ZALO || '');
    location.href = z ? (z + '?text=' + msg) : msg;
  };
}

/* ---------------- W5 R2 4.3: Motion A — consumed chỉ khi đủ điều kiện + bắt đầu/reduce chủ động ----------------
   F2: footer thấy được ở route khác hoặc khi overlay mở = CHƯA tiêu thụ lượt; giữ khả năng kiểm lại
   (tái observe cùng stage để nhận observation mới — một observer duy nhất, không polling).
   Reduce: chủ động dùng trạng thái tĩnh chỉ khi đủ điều kiện trên home; giữa animation -> cancel về identity. */
(function initFooterMotion(){
  const stage = document.getElementById('logoStage');
  const logo = document.getElementById('logoMotion');
  if (!stage || !logo || !('IntersectionObserver' in window)) return; // không IO -> logo tĩnh từ CSS
  let played = false, anim = null, observing = false;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const finishStatic = () => { if (anim) { try { anim.cancel(); } catch (e) {} anim = null; } };
  window.__mjFooterMotion = { finishStatic };
  const homeActive = () => location.pathname === '/' && !document.getElementById('page-home').hidden;
  const overlayOpen = () => {
    const dr = document.getElementById('mobileDrawer');
    const sp = document.getElementById('searchPanel');
    return (dr && !dr.hidden) || (sp && !sp.hidden);
  };
  const eligible = () => homeActive() && !overlayOpen();
  const io = new IntersectionObserver((entries) => {
    if (played) return;
    for (const en of entries) {
      if (en.intersectionRatio < 0.30) continue;
      if (!eligible()) continue;          // chưa tiêu thụ — kiểm lại ở observation sau
      played = true;                       // đủ điều kiện: consume đúng lúc bắt đầu/reduce
      io.disconnect();
      // W8 R1-FLOAT (SUPERSEDES W5 footer motion): footer logo tĩnh màu gốc; bounding animation chuyển
      // sang logo-float.js. Giữ hooks finishStatic/recheck để các caller route/drawer vẫn an toàn (no-op).
      return;
    }
  }, { threshold: [0, 0.3, 0.6, 1] });
  const observe = () => { io.observe(stage); observing = true; };
  observe();
  // reduce đổi giữa chừng: đang chạy -> cancel về identity; chưa played -> IO tự xử khi đủ điều kiện
  const onMq = () => { if (mq.matches) finishStatic(); };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
  // R2: khi đóng panel / rời route khác về home -> tái observe để nhận observation mới (layout hiện tại)
  window.__mjFooterMotionRecheck = () => {
    if (played || !('IntersectionObserver' in window)) return;
    if (observing) { io.unobserve(stage); }
    observe();
  };
})();

/* ---------------- misc ---------------- */
function doSearch(e){
  e.preventDefault();
  const v = $('#searchInput').value.trim();
  const u = new URL(location.origin + '/shop');
  if (v) u.searchParams.set('q', v);
  u.searchParams.set('lang', LANG);   // EN đặc định — luôn giữ lang
  history.pushState({}, '', u.pathname + u.search);
  route();
  // đóng panel + trả focus về trang kết quả
  const sp = $('#searchPanel'); if (sp) { sp.hidden = true; const st = $('#searchToggle'); if (st) { st.setAttribute('aria-expanded', 'false'); } }
  return false;
}
window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.href.startsWith('http') && !a.href.startsWith(location.origin)) return;
  const href = a.getAttribute('href');
  if (!href || href === '#') return;
  e.preventDefault();
  // STOREFRONT 4A: click department nav = mở lựa chọn department mới, xóa filter cũ, giữ lang
  const ad = a.getAttribute('data-dept');
  if (ad && ['men','women','kids'].includes(ad)) { setDepartment(ad); return; }
  // W8/B1: anchor home section (#contact/#channels) từ mọi route — về home + scroll đúng section
  if (href.startsWith('#') && href.length > 1) {
    const id = href.slice(1);
    const sec = document.getElementById(id);
    if (sec) {
      if (location.pathname === '/' && !document.getElementById('page-home').hidden) {
        e.preventDefault();
        goToHomeSection(id, 'instant');
      } else {
        // về home: query trước hash, rồi scroll sau khi section hiện
        e.preventDefault();
        const u = new URL(location.origin + '/');
        u.searchParams.set('lang', LANG);   // EN đặc định
        u.hash = id;
        history.pushState({}, '', u.pathname + u.search + u.hash);
        route();
        goToHomeSection(id, 'afterRoute');
      }
    }
    return;
  }
  // W2.6 + STOREFRONT 4C.3: giữ ngôn ngữ trên MỌI link nội bộ (kể cả đã có ?/hash) — luôn set lang hợp lệ
  let target = '';
  const hashIdx = href.indexOf('#');
  const qIdx = href.indexOf('?');
  const base = hashIdx !== -1 ? href.slice(0, hashIdx) : href;
  const hash = hashIdx !== -1 ? href.slice(hashIdx) : '';
  const u2 = new URL(base, location.origin);
  u2.searchParams.set('lang', LANG);
  target = u2.pathname + u2.search + (qIdx === -1 && hashIdx !== -1 ? '' : '') + hash;
  history.pushState({}, '', target);
  route();
});

function goToHomeSection(id, mode){
  const sec = document.getElementById(id);
  if (!sec) return;
  const doScroll = () => {
    if (!document.getElementById('page-home').hidden) sec.scrollIntoView({ behavior: 'auto', block: 'start' });
  };
  if (mode === 'instant') { doScroll(); return; }
  // sau route: chờ section thật hiện (home render), dùng rAF cho tới khi sẵn sàng
  let tries = 0;
  const tick = () => {
    if (!document.getElementById('page-home').hidden) { doScroll(); return; }
    if (tries++ < 10) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------------- boot ---------------- */
renderCartCount();
// W2.6: ngôn ngữ — đồng bộ LANG với dropdown header + giữ ?lang= khi điều hướng
(function initLang(){
  const sw = $('#langSwitch'), menu = $('#langMenu');
  applyStaticI18n(); // áp text tĩnh the o LANG
  // UIUX-R1 P1b: nhãn nav department theo locale (trước là static Men/Women/Kids)
  document.querySelectorAll('.header-nav a[data-dept], .drawer-nav a[data-dept]').forEach(a => {
    const d = a.getAttribute('data-dept');
    const lbl = d ? deptLabel(d) : '';
    if (lbl) a.textContent = lbl;
  });
  const label = LANG.toUpperCase();
  const cL = $('#langCurrentLabel'); if (cL) cL.textContent = label;
  const cF = $('#langCurrentFlag'); if (cF) cF.hidden = true;
  // W3 4.5: chọn ngôn ngữ từ header menu hoặc drawer; search toggle
  document.addEventListener('click', (e) => {
    const langBtn = e.target.closest('[data-lang]');
    if (langBtn) {
      const next = langBtn.dataset.lang;
      const url = new URL(location.href);
      url.searchParams.set('lang', next);
      location.href = url.href;
      return;
    }
    if (e.target.closest('#langCurrent')) {
      const sw = $('#langSwitch');
      const wasOpen = sw && sw.classList.contains('open');
      if (sw) sw.classList.toggle('open');
      const lc = $('#langCurrent');
      if (lc) lc.setAttribute('aria-expanded', String(!wasOpen));
      return;
    }
    const sw = $('#langSwitch');
    if (sw && !e.target.closest('.lang-menu')) sw.classList.remove('open');
  });
  const st = $('#searchToggle'), sp = $('#searchPanel');
  const closeSearch = (refocus) => {
    if (sp.hidden) return;
    sp.hidden = true;
    st.setAttribute('aria-expanded', 'false');
    if (refocus) st.focus();
    if (window.__mjFooterMotionRecheck) window.__mjFooterMotionRecheck();
  };
  if (st && sp) {
    st.addEventListener('click', () => {
      const open = sp.hidden;
      // không để hai panel chồng nhau: mở search thì đóng drawer + lang menu
      const dr = $('#mobileDrawer'); if (dr && !dr.hidden) { dr.hidden = true; const nb = $('#navToggle'); if (nb) nb.setAttribute('aria-expanded', 'false'); }
      const sw = $('#langSwitch'); if (sw) sw.classList.remove('open');
      if (window.__mjFooterMotion) { if (open) window.__mjFooterMotion.finishStatic(); else if (window.__mjFooterMotionRecheck) window.__mjFooterMotionRecheck(); }
      sp.hidden = !open;
      st.setAttribute('aria-expanded', String(open));
      if (open) { const si = $('#searchInput'); if (si) si.focus(); }
    });
    const si = $('#searchInput');
    if (si) si.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeSearch(true); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sp.hidden && !(e.target && e.target.id === 'searchInput')) closeSearch(true);
    });
  }
  // language control: aria-expanded + keyboard/Escape
  const lc = $('#langCurrent');
  if (lc) lc.setAttribute('aria-expanded', 'false');
  if (lc) lc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const sw = $('#langSwitch'); if (sw) sw.classList.remove('open'); lc.setAttribute('aria-expanded', 'false'); lc.focus(); }
  });
  })();
  // W-UI C 19/9: mobile hamburger — nav + search không mất trên điện thoại
  (function initMobileNav(){
    const btn = $('#navToggle'), drawer = $('#mobileDrawer');
    if (!btn || !drawer) return;
    const close = () => { drawer.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (window.__mjFooterMotionRecheck) window.__mjFooterMotionRecheck(); btn.focus(); };
    btn.addEventListener('click', () => {
      const opening = drawer.hidden;
      // không để hai panel chồng nhau: mở drawer thì đóng search panel + lang menu
      const sp = $('#searchPanel'); if (sp && !sp.hidden) { sp.hidden = true; const st = $('#searchToggle'); if (st) st.setAttribute('aria-expanded', 'false'); }
      const sw = $('#langSwitch'); if (sw) sw.classList.remove('open');
      if (window.__mjFooterMotion) { if (opening) window.__mjFooterMotion.finishStatic(); else if (window.__mjFooterMotionRecheck) window.__mjFooterMotionRecheck(); }
      drawer.hidden = !opening;
      btn.setAttribute('aria-expanded', String(!drawer.hidden));
    });
    drawer.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 960) close(); });
    // W1 S3: Escape đóng drawer khi mở
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) close(); });
    // đồng bộ nội dung 2 ô tìm kiếm (header + drawer)
    const a = $('#searchInput'), b = $('#mSearchInput');
    if (a && b) {
      a.addEventListener('input', () => { b.value = a.value; });
      b.addEventListener('input', () => { a.value = b.value; });
    }
  })();
  // W4 E: disclosure danh bạ kênh — aria-expanded + đổi nhãn
  const ct = $('#channelsToggle'), ca = $('#channelsAll');
  if (ct && ca) ct.addEventListener('click', () => {
    const open = ca.hidden;
    ca.hidden = !open;
    ct.setAttribute('aria-expanded', String(open));
    ct.textContent = open ? t('channels_view_less') : t('channels_view_all');
  });
  // Áp LANG vào mọi link nội bộ và title/lang-page
function langifyLinks(){
  $$('a[href]').forEach(a => {
    const h = a.getAttribute('href');
    if (!h || h.startsWith('#') || h.startsWith('http') || a.target === '_blank') return;
    const u = new URL(h, location.origin);
    u.searchParams.set('lang', LANG);   // luôn giữ lang hợp lệ (kể cả VI) — EN đặc định 20/9
    if (u.href !== new URL(h, location.origin).href && !a.dataset.langBound) {
      a.dataset.langBound = '1'; a.setAttribute('href', u.pathname + u.search + u.hash);
    }
  });
  document.documentElement.lang = {vi:'vi',en:'en',zh:'zh',ko:'ko'}[LANG] || 'en';
}
langifyLinks();
/* STOREFRONT 4D: campaign stage — đọc public/campaigns.json, render 0/1/2+ slide.
   0 slide => vùng trắng (hidden + aria-hidden), không timer/không broken ảnh. */
let CAMPAIGN = { idx: 0, slides: [] };
function campaignRun(){
  const stage = $('#campaignStage'); if (!stage) return;
  const enabled = (CAMPAIGN.slides || []).filter(s => s && s.enabled !== false);
  if (!enabled.length) { stage.hidden = true; stage.setAttribute('aria-hidden','true'); return; }
  const track = $('#campaignTrack'), ctrl = $('#campaignControls'), dots = $('#campaignDots');
  track.innerHTML = enabled.map((s, i) => {
    const useMobile = s.imageMobile && window.innerWidth < 768;
    const img = '<img src="' + esc(useMobile ? s.imageMobile : s.imageDesktop) + '" alt="' + esc((s.alt && (s.alt[LANG] || s.alt.en)) || '') + '" loading="lazy">';
    return '<div class="campaign-slide' + (i === 0 ? ' active' : '') + '">' + (s.href ? '<a href="' + esc(s.href) + '">' + img + '</a>' : img) + '</div>';
  }).join('');
  if (enabled.length > 1) {
    dots.innerHTML = enabled.map((_, i) => '<button type="button" class="campaign-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>').join('');
    ctrl.hidden = false;
  } else { dots.innerHTML = ''; ctrl.hidden = true; }
  stage.hidden = false; stage.removeAttribute('aria-hidden');
  function goTo(i){
    CAMPAIGN.idx = (i + enabled.length) % enabled.length;
    document.querySelectorAll('.campaign-slide').forEach((el, j) => el.classList.toggle('active', j === CAMPAIGN.idx));
    document.querySelectorAll('.campaign-dot').forEach((el, j) => el.classList.toggle('active', j === CAMPAIGN.idx));
  }
  const prev = $('#campaignPrev'), next = $('#campaignNext');
  if (prev) prev.onclick = (e)=>{ e.stopPropagation(); goTo(CAMPAIGN.idx - 1); };
  if (next) next.onclick = (e)=>{ e.stopPropagation(); goTo(CAMPAIGN.idx + 1); };
  dots.querySelectorAll('.campaign-dot').forEach(d => d.onclick = () => goTo(Number(d.getAttribute('data-i'))));
  document.addEventListener('keydown', function ke(e){
    if (stage.hidden) return;
    if (e.key === 'ArrowLeft') { goTo(CAMPAIGN.idx - 1); }
    else if (e.key === 'ArrowRight') { goTo(CAMPAIGN.idx + 1); }
  });
}
function loadCampaign(){
  fetch('/campaigns.json').then(r => r.json()).then(d => { CAMPAIGN.slides = Array.isArray(d && d.slides) ? d.slides : []; campaignRun(); })
    .catch(() => { CAMPAIGN.slides = []; campaignRun(); });
}
loadCampaign();
// CONTENT C: footer accordion (mobile) — heading bấm được, không reset selection/app
(function(){
  var y=document.querySelectorAll('[data-year]');
  for (var i=0;i<y.length;i++) y[i].textContent = new Date().getFullYear();
})();
(function(){
  document.querySelectorAll('.footer-col[data-acc]').forEach(col => {
    const h = col.querySelector('.footer-heading');
    if (!h) return;
    const sync = () => h.setAttribute('aria-expanded', col.hasAttribute('data-open') ? 'true' : 'false');
    h.addEventListener('click', () => { col.toggleAttribute('data-open'); sync(); });
    h.setAttribute('tabindex','0'); h.setAttribute('role','button');
    sync();
    h.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); col.toggleAttribute('data-open'); sync(); }
    });
  });
})();
const uq = new URLSearchParams(location.search).get('q');
if (uq) {
  const el = $('#fSearch'); if (el) el.value = uq;
  if (location.pathname !== '/shop') history.replaceState({}, '', '/shop');
  route();
} else {
  route();
}
/* ---------------- V2 FEED FLAG (internal-only) ----------------
   UIUX-R1 P1: XOA nut beta "🧪 Thử kho mới 738k" khoi UI khach hang (truoc: floating button z-index:9999 che drawer).
   Feed van mac dinh lot-1 (curated 280) cho khach; dev co the bat kho 738k qua localStorage mj_feed=v2 (internal, khong co nut tren UI). */
(function(){
  try {
    window.__MJ_FEED__ = (localStorage.getItem('mj_feed') === 'v2') ? 'v2' : 'lot1';
  } catch (e) {}
})();
