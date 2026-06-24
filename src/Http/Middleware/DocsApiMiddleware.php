<?php

namespace Yudafhd\LaravelDocs\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

class DocsApiMiddleware
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        // Allow in local or development environment automatically
        if (app()->environment('local') || app()->environment('development')) {
            return $next($request);
        }

        // Otherwise check the standard API docs gate
        if (Gate::allows('viewApiDocs')) {
            return $next($request);
        }

        abort(403);
    }
}
