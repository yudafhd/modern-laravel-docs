<?php

use Illuminate\Support\Facades\Route;
use Yudafhd\Larafeel\Http\Middleware\LarafeelApiMiddleware;

Route::get('/docs/larafeel', function () {
    return view('larafeel::docs');
})->middleware([
    'web',
    LarafeelApiMiddleware::class,
]);
