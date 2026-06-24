<?php

namespace Yudafhd\LaravelDocs;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Gate;

class DocsServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Merge scramble configuration from package
        $this->mergeConfigFrom(__DIR__.'/../config/scramble.php', 'scramble');
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            // Allow publishing the Scramble config
            $this->publishes([
                __DIR__.'/../config/scramble.php' => config_path('scramble.php'),
            ], 'modern-laravel-docs-config');

            // Allow publishing the React UI documentation assets
            $this->publishes([
                __DIR__.'/../resources/js/docs' => resource_path('js/docs'),
            ], 'modern-laravel-docs-assets');
        }

        // Define a fallback for the viewApiDocs Gate if not already defined in the application
        if (!Gate::has('viewApiDocs')) {
            Gate::define('viewApiDocs', function ($user = null) {
                return true;
            });
        }
    }
}
