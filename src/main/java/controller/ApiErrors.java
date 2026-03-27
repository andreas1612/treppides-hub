package controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice(basePackages = "controller", annotations = RestController.class)
public class ApiErrors {
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String,String>> handleAll(Exception e) {
        e.printStackTrace(); // logs full stack trace
        return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getClass().getSimpleName() + ": " + e.getMessage()));
    }
}

