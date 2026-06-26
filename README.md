# Larafeel 🚀

[![Latest Version on Packagist](https://img.shields.io/packagist/v/yudafhd/larafeel.svg?style=flat-square)](https://packagist.org/packages/yudafhd/larafeel)
[![Total Downloads](https://img.shields.io/packagist/dt/yudafhd/larafeel.svg?style=flat-square)](https://packagist.org/packages/yudafhd/larafeel)
[![Software License](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](LICENSE)

**Larafeel** adalah paket (package) Laravel yang dirancang untuk menghadirkan dashboard dokumentasi API interaktif yang modern dan responsif. Larafeel menggabungkan kemampuan **Scramble** untuk auto-generation dokumentasi OpenAPI (tanpa perlu anotasi manual PHPDoc) dengan antarmuka klien API (**React-based dashboard**) yang kaya fitur layaknya Postman atau Insomnia langsung di browser Anda.

Akses dokumentasi Anda dengan mudah melalui rute `/docs/larafeel`!

---

## ✨ Fitur Utama

- **⚡ Auto-Documentation (Scramble Integration):** Secara otomatis mendeteksi rute, request rules, dan response API Laravel Anda. Tidak perlu lagi menulis komentar PHPDoc yang panjang dan melelahkan.
- **💻 Interactive API Client (Try It):** Uji endpoint Anda secara langsung dari dashboard. Mendukung parameter query, path variables, request body, headers, hingga upload file (multipart/form-data).
- **🔑 Persistent Authorization:** Dukungan untuk Bearer Token, API Key (via Header atau Query), dan Basic Auth. Token Anda tersimpan dengan aman di `localStorage` sehingga Anda tidak perlu memasukkannya berulang kali.
- **📜 Request History:** Menyimpan riwayat request API Anda di sidebar secara lokal, memudahkan Anda untuk memanggil ulang request sebelumnya dengan sekali klik.
- **🛠️ Deep Schema Explorer:** Eksplorasi struktur data request dan response JSON secara interaktif menggunakan node tree viewer yang informatif.
- **🎨 Code Snippet Generator:** Hasilkan kode integrasi instan untuk berbagai bahasa/library populer:
  - `cURL`
  - `JavaScript` (Fetch API)
  - `Python` (Requests)
  - `PHP` (Guzzle)
- **🌗 Theme Switcher:** Mendukung mode tampilan `Light`, `Dark`, atau sinkronisasi otomatis dengan `System`.
- **🔒 Secure by Default:** Dokumentasi otomatis aktif di lingkungan `local` dan `development`. Untuk production, akses dilindungi menggunakan Laravel Gate (`viewApiDocs`).

---

## 🚀 Instalasi

Ikuti langkah-langkah mudah berikut untuk memasang Larafeel di proyek Laravel Anda:

### 1. Install via Composer
Tambahkan package ke proyek Anda menggunakan Composer:
```bash
composer require yudafhd/larafeel
```

### 2. Publish Konfigurasi
Publish file konfigurasi `larafeel.php` untuk memodifikasi pengaturan bawaan:
```bash
php artisan vendor:publish --tag=larafeel-config
```

### 3. Publish Asset Frontend
Publish aset JavaScript dan CSS yang diperlukan oleh dashboard React:
```bash
php artisan vendor:publish --tag=laravel-assets
```

Setelah selesai, buka browser Anda dan akses:
```
http://localhost:8000/docs/larafeel
```

---

## ⚙️ Konfigurasi (`config/larafeel.php`)

Setelah mempublikasikan konfigurasi, Anda dapat mengaturnya di file `config/larafeel.php`. Berikut opsi-opsi penting yang dapat disesuaikan:

| Opsi | Default | Deskripsi |
|------|---------|-----------|
| `api_path` | `'api'` | Prefix rute Laravel yang akan dimasukkan ke dokumentasi API. |
| `export_path` | `'api.json'` | Path di mana spesifikasi OpenAPI (JSON) akan diekspos (misal: `/docs/api.json`). |
| `ui.title` | `'Larafeel'` | Judul halaman dokumentasi pada browser. |
| `ui.theme` | `'system'` | Tema default dashboard (`light`, `dark`, atau `system`). |
| `ui.layout` | `'responsive'` | Tata letak dashboard (`sidebar`, `responsive`, atau `stacked`). |
| `ui.hide_try_it`| `false` | Set ke `true` untuk menyembunyikan fitur pengujian API client. |

---

## 🔒 Kontrol Akses & Keamanan

Secara default, Larafeel mengizinkan akses tanpa batasan pada environment **`local`** dan **`development`**.

Untuk lingkungan produksi, Anda harus mendefinisikan Gate bernama `viewApiDocs` di dalam `App\Providers\AppServiceProvider.php` (Laravel 11+) atau `AuthServiceProvider.php` (Laravel 10) untuk mengontrol siapa saja yang boleh melihat dokumentasi API:

```php
use Illuminate\Support\Facades\Gate;

/**
 * Bootstrap any application services.
 */
public function boot(): void
{
    // Batasi akses hanya untuk pengguna admin yang terotentikasi
    Gate::define('viewApiDocs', function ($user = null) {
        return optional($user)->is_admin;
    });
}
```

---

## 🛠️ Pengembangan & Kustomisasi Aset Frontend

Jika Anda ingin berkontribusi atau menyesuaikan antarmuka React dari dashboard Larafeel, Anda dapat memodifikasi file di dalam `resources/js/docs` dan membangun ulang asetnya:

1. **Install Dependencies:**
   ```bash
   pnpm install
   # atau menggunakan npm:
   npm install
   ```

2. **Jalankan Build Production:**
   ```bash
   npm run build
   ```
   *Perintah ini akan menggunakan Vite untuk mengompilasi JavaScript dan CSS ke direktori `resources/dist`.*

3. **Jalankan Watcher (Mode Development):**
   ```bash
   npm run watch
   ```

4. **Update Aset di Proyek Host:**
   Jangan lupa untuk mempublikasikan kembali aset ke folder `public` proyek Laravel Anda setelah melakukan kompilasi ulang:
   ```bash
   php artisan vendor:publish --tag=laravel-assets --force
   ```

---

## 📄 Lisensi

Larafeel dilisensikan di bawah **[MIT License](LICENSE)**. Anda bebas menggunakan, memodifikasi, dan mendistribusikannya untuk proyek pribadi maupun komersial.

---

<p align="center">
  Dibuat dengan ❤️ oleh <a href="https://github.com/yudafhd">Yuda</a>
</p>
