package main

import (
	"fmt"
	"net/smtp"
	"strings"

	"familychat/internal/config"
)

func sendInvitationMail(cfg config.Config, to, token, family, role, relationship string) error {
	if cfg.MailHost == "" || cfg.MailFrom == "" {
		return nil
	}
	addr := fmt.Sprintf("%s:%s", cfg.MailHost, cfg.MailPort)
	auth := smtp.PlainAuth("", cfg.MailUsername, cfg.MailPassword, cfg.MailHost)
	link := strings.TrimRight(cfg.PublicURL, "/") + "/?invite=" + token
	subject := "Приглашение в семейный чат"
	body := fmt.Sprintf("Вас пригласили в семью «%s». Роль: %s, статус: %s.\r\n\r\nПримите приглашение: %s\r\nОдноразовый код: %s\r\n", family, role, relationship, link, token)
	msg := []byte("From: " + cfg.MailFrom + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	return smtp.SendMail(addr, auth, cfg.MailFrom, []string{to}, msg)
}
